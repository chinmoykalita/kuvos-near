import json
import logging
import mimetypes
import os
import re
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

import boto3
from botocore.config import Config

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from kuvos_worker.extractor import ExtractionRequest, extract_document
from kuvos_worker.near_ai_adapter import public_attestations


logger = logging.getLogger("kuvos_worker.jobs")


# One fast extractor and no evaluator by default: every item is human-reviewed. Set two
# extractor models and an evaluator for cross-checking. All are NEAR AI Cloud TEE models.
_DEFAULTS = {
    "EXTRACTOR_MODELS": "Qwen/Qwen3.6-35B-A3B-FP8",
    "EVALUATOR_MODEL": "",
    "VISION_OCR_MODEL": "Qwen/Qwen3-VL-30B-A3B-Instruct",
}


def _model(role: str) -> str:
    return os.getenv(f"NEARAI_{role}", _DEFAULTS[role])


def _models() -> list[str]:
    return [model.strip() for model in _model("EXTRACTOR_MODELS").split(",") if model.strip()]


def _extract_local(source_path: Path, run_root: Path) -> tuple[dict, Path]:
    response = extract_document(
        ExtractionRequest(
            document_path=source_path,
            run_root=run_root,
            extractor_models=_models(),
            evaluator_model=_model("EVALUATOR_MODEL"),
            vision_ocr_model=_model("VISION_OCR_MODEL"),
            vision_fallback_confidence=float(os.getenv("VISION_FALLBACK_CONFIDENCE", "0.70")),
        )
    )
    document_result = json.loads(
        (response.run_dir / "document.json").read_text(encoding="utf-8")
    )
    document_result.pop("original_path", None)
    evaluation = json.loads(
        (response.run_dir / "evaluation.json").read_text(encoding="utf-8")
    )
    manifest = json.loads(
        response.manifest_path.read_text(encoding="utf-8")
    )
    attestations_path = response.run_dir / "ai-attestations.json"
    result = {
        "document": document_result,
        "evaluation": evaluation["result"],
        "provenance_issues": evaluation["provenance_issues"],
        "manifest": manifest,
        # Signer, signature and signed hashes per model call; quotes stay in the run artifact.
        "attestations": public_attestations(
            json.loads(attestations_path.read_text(encoding="utf-8"))
        )
        if attestations_path.exists()
        else [],
    }
    return result, response.run_dir


def _s3():
    # AWS_ENDPOINT_URL_S3 (read by boto3) targets local MinIO; it needs path-style URLs.
    if os.getenv("S3_FORCE_PATH_STYLE") == "true":
        return boto3.client("s3", config=Config(s3={"addressing_style": "path"}))
    return boto3.client("s3")


def _document_location(document_path: str) -> tuple[str, str]:
    location = urlsplit(document_path)
    bucket = os.getenv("DOCUMENTS_BUCKET", "")
    key = location.path.lstrip("/")
    if (
        not bucket or location.netloc != bucket or location.query or location.fragment
        or not re.fullmatch(r"documents/[0-9a-f-]{36}/original\.(pdf|png|jpe?g|tiff?)", key)
    ):
        raise ValueError("Invalid document storage location.")
    return bucket, key


def _extract_stored(
    document_path: str, extraction_id: str, data_dir: Path
) -> tuple[dict, str]:
    if not document_path.startswith("s3://"):
        result, run_dir = _extract_local(Path(document_path), data_dir / "runs")
        return result, str(run_dir.resolve())
    bucket, key = _document_location(document_path)
    s3 = _s3()
    prefix = f"{key.rsplit('/', 1)[0]}/runs/{extraction_id}"
    with TemporaryDirectory(prefix="kuvos-document-") as working:
        root = Path(working)
        source_path = root / Path(key).name
        run_root = root / "runs"
        s3.download_file(bucket, key, str(source_path))
        try:
            result, _run_dir = _extract_local(source_path, run_root)
        except Exception as error:
            run_root.mkdir(parents=True, exist_ok=True)
            (run_root / "error.json").write_text(
                json.dumps({"type": type(error).__name__, "message": str(error)}),
                encoding="utf-8",
            )
            raise
        finally:
            # ponytail: one pipeline run per temporary job; keep distinct prefixes if jobs gain multiple runs.
            for path in sorted(run_root.rglob("*")):
                if not path.is_file():
                    continue
                relative = path.relative_to(run_root)
                if len(relative.parts) > 1:
                    relative = Path(*relative.parts[1:])
                s3.upload_file(
                    str(path), bucket, f"{prefix}/{relative.as_posix()}",
                    ExtraArgs={"ContentType": mimetypes.guess_type(path.name)[0] or "application/octet-stream"},
                )
        return result, f"s3://{bucket}/{prefix}"


def _discard_deleted_document(document_path: str) -> None:
    if not document_path.startswith("s3://"):
        return
    bucket, key = _document_location(document_path)
    prefix = f"{key.rsplit('/', 1)[0]}/"
    s3 = _s3()
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=prefix
    ):
        objects = [{"Key": item["Key"]} for item in page.get("Contents", [])]
        if objects:
            response = s3.delete_objects(
                Bucket=bucket, Delete={"Objects": objects}
            )
            if response.get("Errors"):
                raise RuntimeError("Deleted document cleanup failed.")


def process_one(database_url: str, data_dir: Path) -> bool:
    # ponytail: one database claim per poll is enough until extraction throughput matters.
    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        with connection.transaction():
            extraction = connection.execute(
                """
                WITH next AS (
                  SELECT id FROM extractions
                  WHERE status = 'QUEUED'
                  ORDER BY created_at
                  FOR UPDATE SKIP LOCKED
                  LIMIT 1
                )
                UPDATE extractions AS extraction
                SET status = 'PROCESSING', started_at = NOW(), error = NULL
                FROM next
                WHERE extraction.id = next.id
                RETURNING extraction.id, extraction.document_id
                """
            ).fetchone()
            if not extraction:
                return False
            document = connection.execute(
                "SELECT path FROM documents WHERE id = %s",
                (extraction["document_id"],),
            ).fetchone()

    extraction_id = str(extraction["id"])
    logger.info("Extraction %s processing started", extraction_id)
    try:
        if not document:
            raise FileNotFoundError("Extraction document record is missing.")
        result, run_location = _extract_stored(
            str(document["path"]), extraction_id, data_dir
        )
        with psycopg.connect(database_url) as connection:
            updated = connection.execute(
                """
                UPDATE extractions
                SET status = 'REVIEW_READY', result = %s, run_dir = %s,
                    completed_at = NOW(), error = NULL
                WHERE id = %s
                """,
                (Jsonb(result), run_location, extraction_id),
            )
        if updated.rowcount:
            logger.info("Extraction %s is ready for review", extraction_id)
    except Exception as error:
        logger.error("Extraction %s failed (%s)", extraction_id, type(error).__name__)
        with psycopg.connect(database_url) as connection:
            updated = connection.execute(
                """
                UPDATE extractions
                SET status = 'FAILED', error = %s, completed_at = NOW()
                WHERE id = %s
                """,
                (
                    "The document could not be processed. Please try uploading it again.",
                    extraction_id,
                ),
            )
    if updated.rowcount == 0 and document:
        # Account deletion can finish while extraction is still publishing artifacts.
        _discard_deleted_document(str(document["path"]))
    return True


def run_job_loop(stopped: threading.Event, data_dir: Path) -> None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to run the extraction worker.")
    poll_seconds = float(os.getenv("WORKER_POLL_SECONDS", "2"))
    logger.info("Extraction worker is polling for jobs")
    while not stopped.is_set():
        if not process_one(database_url, data_dir):
            stopped.wait(poll_seconds)
