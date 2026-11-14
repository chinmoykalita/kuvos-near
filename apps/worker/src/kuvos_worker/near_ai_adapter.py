"""NEAR AI Cloud private inference for the extraction pipeline.

The official SDK verifies the NEAR AI Gateway and model Intel TDX (and NVIDIA GPU) attestation
before any document text is sent, optionally end-to-end encrypts the prompt to the attested
model key, and then verifies the model TEE's signature over the exact request and response
bytes. Kuvos accepts only ``provider_tee`` signatures: a Gateway signature does not prove the
model itself ran inside a TEE, so such a reply fails the job instead of entering review.
"""

import asyncio
import base64
import logging
import mimetypes
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any, Sequence, TypeVar

from pydantic import BaseModel, ValidationError

from kuvos_worker.models import (
    EvaluationResult,
    Explanation,
    ModelExtraction,
    ModelRun,
    PreparedDocument,
    VisionPageTranscription,
)
from kuvos_worker.prompts import (
    EVALUATION_PROMPT,
    EXTRACTION_PROMPT,
    VISION_TRANSCRIPTION_PROMPT,
    _spans_text,
)


ResultModel = TypeVar("ResultModel", bound=BaseModel)
logger = logging.getLogger("kuvos_worker.near_ai")


def _image_url(path: Path) -> str:
    media_type = mimetypes.guess_type(path.name)[0] or "image/png"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def _strict_schema(value: Any) -> Any:
    """Strict JSON schema: every object refuses properties the model was not asked for."""
    if isinstance(value, dict):
        if value.get("type") == "object":
            value["additionalProperties"] = False
        for nested in value.values():
            _strict_schema(nested)
    elif isinstance(value, list):
        for nested in value:
            _strict_schema(nested)
    return value


def _json_text(raw_text: str) -> str:
    """Models sometimes wrap JSON in a ``` fence; return the JSON inside."""
    text = raw_text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


class _Loop:
    """One background event loop keeps the SDK client, its attestation cache and the
    retained response bytes alive across the synchronous pipeline's calls."""

    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        threading.Thread(target=self.loop.run_forever, daemon=True, name="near-ai").start()

    def run(self, coroutine: Any, timeout: float) -> Any:
        return asyncio.run_coroutine_threadsafe(coroutine, self.loop).result(timeout)


_shared: dict[str, Any] = {}
_lock = threading.Lock()


def _runtime() -> tuple[_Loop, Any]:
    with _lock:
        if "client" not in _shared:
            from nearai_inference_sdk import InferenceClient

            api_key = os.getenv("NEARAI_API_KEY")
            if not api_key:
                raise RuntimeError("NEARAI_API_KEY is required for NEAR AI Cloud calls.")
            loop = _Loop()

            async def create() -> Any:
                return InferenceClient(
                    api_key,
                    base_url=os.getenv("NEARAI_BASE_URL", "https://cloud-api.near.ai/v1"),
                    e2ee=os.getenv("NEARAI_E2EE", "true") == "true",
                    signing_algo="ed25519",
                )

            _shared["loop"] = loop
            _shared["client"] = loop.run(create(), 60)
        return _shared["loop"], _shared["client"]


def attestation_record(verified: Any, model: str, purpose: str) -> dict[str, Any]:
    signature = verified.signature
    reports = getattr(verified, "attestations", None) or ()
    report = reports[0] if reports else None
    deployment = getattr(report, "deployment", None)
    measurements = getattr(deployment, "runtime_measurements", None)
    return {
        "provider": "near-ai-cloud",
        "purpose": purpose,
        "model": model,
        "completionId": verified.id,
        "signatureKind": verified.signature_kind,
        "signedText": signature.signed_text,
        "signature": signature.signature,
        "signingAlgo": signature.signer.signing_algo,
        "signingAddress": signature.signer.signing_address,
        "tcbStatus": getattr(report, "tcb_status", None),
        "composeHash": getattr(measurements, "compose_hash", None),
        "osImageHash": getattr(measurements, "os_image_hash", None),
        "gpuEvidence": getattr(report, "gpu_evidence", None),
        "e2ee": os.getenv("NEARAI_E2EE", "true") == "true",
        "verifiedAt": datetime.now(UTC).isoformat(),
    }


class NearAIExtractor:
    """Extraction, evaluation, page transcription and explanations on NEAR AI Cloud
    Confidential TEE models, with a verified model-TEE signature on every reply."""

    def __init__(self, timeout_ms: int | None = None) -> None:
        self.timeout_ms = timeout_ms or int(os.getenv("NEARAI_TIMEOUT_MS", "480000"))
        self.last_model = ""
        self.last_provider = "near-ai-cloud"
        self.attestations: list[dict[str, Any]] = []

    def structured(
        self,
        model: str,
        prompt: str,
        result_model: type[ResultModel],
        images: Sequence[Path] = (),
    ) -> ResultModel:
        model = model.strip()
        if not model:
            raise ValueError("NEAR AI model is required.")
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        for image in images:
            content.append({"type": "text", "text": f"Rendered source image: {image.name}"})
            content.append({"type": "image_url", "image_url": {"url": _image_url(image)}})
        schema = _strict_schema(result_model.model_json_schema())
        request = {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": result_model.__name__, "schema": schema, "strict": True},
            },
            "max_tokens": int(os.getenv("NEARAI_MAX_TOKENS", "16000")),
            # Qwen reasoning traces add minutes per call on long documents; the evaluator and
            # deterministic provenance checks, not hidden reasoning, gate what reaches review.
            "extra_body": {
                "chat_template_kwargs": {"enable_thinking": os.getenv("NEARAI_THINKING", "false") == "true"}
            },
        }
        loop, client = _runtime()
        self.last_model = model
        started_at = perf_counter()
        logger.info(
            "NEAR AI request started: schema=%s model=%s images=%d",
            result_model.__name__,
            model,
            len(images),
        )

        async def call() -> tuple[str, Any]:
            completion = await client.chat.completions.create(**request)
            verified = await client.verify_response(completion.id)
            choice = completion.choices[0]
            usage = getattr(completion, "usage", None)
            logger.info(
                "NEAR AI reply received: model=%s output_tokens=%s",
                model,
                getattr(usage, "completion_tokens", "?"),
            )
            if choice.finish_reason == "length":
                raise RuntimeError(f"NEAR AI model {model} hit the output limit.")
            return choice.message.content or "", verified

        raw_text, verified = loop.run(call(), self.timeout_ms / 1000)
        if verified.signature_kind != "provider_tee":
            raise RuntimeError(
                f"NEAR AI reply for {model} carried a {verified.signature_kind} signature, "
                "not provider_tee; model TEE execution is unproven."
            )
        self.attestations.append(attestation_record(verified, model, result_model.__name__))
        logger.info(
            "NEAR AI request verified: schema=%s model=%s signature=%s duration=%.1fs",
            result_model.__name__,
            model,
            verified.signature_kind,
            perf_counter() - started_at,
        )
        if not raw_text.strip():
            raise RuntimeError(f"NEAR AI model {model} returned no text output.")
        try:
            return result_model.model_validate_json(_json_text(raw_text))
        except ValidationError:
            # Do not log model output; it can contain document text.
            raise

    def explain(self, model: str, prompt: str) -> Explanation:
        return self.structured(model, prompt, Explanation)

    def transcribe_page(self, model: str, image_path: Path) -> VisionPageTranscription:
        return self.structured(
            model, VISION_TRANSCRIPTION_PROMPT, VisionPageTranscription, images=[image_path]
        )

    def extract(self, model: str, document: PreparedDocument, run_dir: Path) -> ModelExtraction:
        prompt = EXTRACTION_PROMPT.format(document_kind=document.kind, spans=_spans_text(document))
        return self.structured(model, prompt, ModelExtraction)

    def evaluate(
        self,
        model: str,
        document: PreparedDocument,
        model_runs: list[ModelRun],
        run_dir: Path,
    ) -> EvaluationResult:
        prompt = EVALUATION_PROMPT.format(
            spans=_spans_text(document),
            model_runs="\n\n".join(run.model_dump_json(indent=2) for run in model_runs),
        )
        return self.structured(model, prompt, EvaluationResult)


def public_attestations(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Summaries stored with the extraction result (no Intel quote)."""
    return [{key: value for key, value in record.items() if key != "intelQuote"} for record in records]


__all__ = [
    "NearAIExtractor",
    "BaseModel",
    "public_attestations",
]
