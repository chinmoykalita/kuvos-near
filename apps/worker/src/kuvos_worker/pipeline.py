import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from kuvos_worker.documents import prepare_document
from kuvos_worker.models import (
    BoundingBox,
    EvaluatedCandidate,
    EvaluationResult,
    Explanation,
    ModelExtraction,
    ModelRun,
    PreparedDocument,
    RunManifest,
    SourceSpan,
)
from kuvos_worker.near_ai_adapter import NearAIExtractor
from kuvos_worker.provenance import validate_evaluation, validate_extraction
from kuvos_worker.review import render_review_artifacts


logger = logging.getLogger("kuvos_worker.pipeline")


def _save_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def _safe_filename(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-")


def _page_needs_vision_ocr(
    document: PreparedDocument,
    page_number: int,
    confidence_threshold: float,
) -> bool:
    spans = [span for span in document.source_spans if span.page == page_number]
    if not spans:
        return True
    average_confidence = sum(span.confidence for span in spans) / len(spans)
    meaningful_text = sum(len(span.text.strip()) for span in spans)
    return average_confidence < confidence_threshold or meaningful_text < 30


def _box(xmin: int, ymin: int, xmax: int, ymax: int) -> BoundingBox:
    xmin, xmax = sorted((xmin, xmax))
    ymin, ymax = sorted((ymin, ymax))
    return BoundingBox(
        x=xmin / 1000,
        y=ymin / 1000,
        width=(xmax - xmin) / 1000,
        height=(ymax - ymin) / 1000,
    )


def _vision_boxes(boxes: list[list[int]]) -> list[BoundingBox]:
    """Vision models disagree on coordinate order: some follow the schema's
    [ymin, xmin, ymax, xmax], others answer [x1, y1, x2, y2] regardless. Text lines
    are wider than they are tall, so each page keeps the reading that makes most lines
    horizontal. Both orders use a 0-1000 scale."""
    values = [[max(0, min(1000, value)) for value in box] for box in boxes]
    y_first = [_box(b[1], b[0], b[3], b[2]) for b in values]
    x_first = [_box(b[0], b[1], b[2], b[3]) for b in values]
    wide = lambda candidate: sum(box.width > box.height for box in candidate)  # noqa: E731
    return x_first if wide(x_first) > wide(y_first) else y_first


def _apply_vision_ocr(
    document: PreparedDocument,
    run_dir: Path,
    extractor: NearAIExtractor,
    model: str,
    confidence_threshold: float,
) -> None:
    for page in document.pages:
        if page.kind != "scanned" or not _page_needs_vision_ocr(
            document, page.page, confidence_threshold
        ):
            continue

        started_at = perf_counter()
        logger.info("Vision OCR fallback started: page=%d model=%s", page.page, model)
        original_spans = [
            span for span in document.source_spans if span.page == page.page
        ]
        _save_json(
            run_dir / "ocr" / f"pre-vision-page-{page.page:04d}.json",
            [span.model_dump(mode="json") for span in original_spans],
        )
        transcription = extractor.transcribe_page(model, run_dir / page.image_path)
        _save_json(
            run_dir / "ocr" / f"vision-page-{page.page:04d}.json",
            {
                "model": model,
                "resolved_model": getattr(extractor, "last_model", "") or model,
                "provider": extractor.last_provider,
                "result": transcription.model_dump(mode="json"),
            },
        )

        lines = [line for line in transcription.lines if line.text.strip()]
        vision_spans = [
            SourceSpan(
                span_id=f"p{page.page:04d}-v{index:04d}",
                page=page.page,
                text=line.text,
                bounding_box=box,
                method="vision_ocr",
                confidence=0.8 if line.clarity == "clear" else 0.4,
            )
            for index, (line, box) in enumerate(
                zip(lines, _vision_boxes([line.box_2d for line in lines])), start=1
            )
        ]
        document.source_spans = [
            span for span in document.source_spans if span.page != page.page
        ] + vision_spans
        page.source_span_ids = [span.span_id for span in vision_spans]
        logger.info(
            "Vision OCR fallback completed: page=%d spans=%d duration=%.1fs",
            page.page,
            len(vision_spans),
            perf_counter() - started_at,
        )

    _save_json(run_dir / "document.json", document.model_dump(mode="json"))


def _correct_unmeasured_interval(candidate) -> None:
    """OD, BD, and similar counts are not hour intervals when no gap was extracted."""
    schedule = getattr(candidate, "schedule", None)
    if schedule is None or getattr(schedule, "kind", None) != "interval":
        return
    if float(getattr(schedule, "interval_hours", 0) or 0) > 0:
        return
    count = int(getattr(schedule, "count", 0) or 0)
    if count > 0:
        schedule.kind = "times_per_day"
    elif getattr(candidate, "category", None) == "follow_up":
        schedule.kind = "once"
    else:
        return
    schedule.needs_user_input = not list(getattr(schedule, "times", None) or [])


_AS_NEEDED = re.compile(r"\b(SOS|PRN|as needed|when needed|if needed|when required|if required)\b", re.I)


def _correct_document_kind(candidate) -> None:
    """Scheduling rules the document wording already decides: restrictions are persistent
    items, and SOS/as-needed medicines create no timed occurrences."""
    schedule = getattr(candidate, "schedule", None)
    if schedule is None:
        return
    category = getattr(candidate, "category", None)
    if category == "restriction":
        schedule.kind = "persistent"
    elif category == "medication" and _AS_NEEDED.search(
        f"{schedule.raw_text} {getattr(candidate, 'instruction_text', '')}"
    ):
        schedule.kind = "as_needed"
        schedule.times = []
    else:
        return
    schedule.needs_user_input = False


def _apply_review_policy(
    evaluation: EvaluationResult,
    document: PreparedDocument,
    model_runs: list[ModelRun],
) -> None:
    span_methods = {span.span_id: span.method for span in document.source_spans}
    candidate_models = {
        candidate.candidate_id: run.resolved_model or run.model
        for run in model_runs
        for candidate in run.extraction.candidates
    }
    candidates_with_issues = {
        issue.split(":", 1)[0].split(".", 1)[0]
        for run in model_runs
        for issue in run.provenance_issues
    }

    for candidate in evaluation.candidates:
        # ponytail: keep explanations empty until enrichment leaves the critical path.
        candidate.explanation = Explanation()
        _correct_unmeasured_interval(candidate)
        _correct_document_kind(candidate)
        if candidate.review_status == "unsupported":
            continue

        reasons: list[str] = []
        contributing_models = {
            candidate_models[source_id]
            for source_id in candidate.source_candidate_ids
            if source_id in candidate_models
        }
        if len(contributing_models) < 2:
            reasons.append("Fewer than two independent extractor models support this item.")
        if any(
            span_methods.get(span_id) == "vision_ocr"
            for span_id in candidate.evidence_span_ids
        ):
            reasons.append("The source was transcribed from an image by a vision model.")
        if any(
            source_id in candidates_with_issues
            for source_id in candidate.source_candidate_ids
        ):
            reasons.append("A contributing extraction has provenance validation issues.")

        if reasons:
            candidate.review_status = "needs_review"
            candidate.disagreement_notes.extend(
                reason for reason in reasons if reason not in candidate.disagreement_notes
            )


def _clean_span_ids(extraction: ModelExtraction) -> ModelExtraction:
    """Some models wrap span IDs as "[p0001-s0008]". Only the wrapping is removed; an ID that
    still does not match a real span is reported by provenance validation as before.
    Fields with no cited evidence at all are removed."""

    def clean(ids: list[str]) -> list[str]:
        return [span_id.strip().strip("[]").strip() for span_id in ids]

    for candidate in extraction.candidates:
        candidate.evidence_span_ids = clean(candidate.evidence_span_ids)
        candidate.schedule.evidence_span_ids = clean(candidate.schedule.evidence_span_ids)
        for field in candidate.fields:
            field.evidence_span_ids = clean(field.evidence_span_ids)
        # A structured field the model cannot tie to the document (for example a "route: oral"
        # the prescription never states) is dropped rather than shown; the instruction text keeps
        # everything the document says.
        candidate.fields = [field for field in candidate.fields if field.evidence_span_ids]
    for field in extraction.document_context:
        field.evidence_span_ids = clean(field.evidence_span_ids)
    for item in extraction.unresolved:
        item.evidence_span_ids = clean(item.evidence_span_ids)
    return extraction


def _unevaluated(run: ModelRun) -> EvaluationResult:
    """Review candidates taken directly from one extractor, without a model evaluator.
    The review policy still marks each one as needing review (fewer than two models), and
    provenance validation still runs on the result."""
    return EvaluationResult(
        candidates=[
            EvaluatedCandidate(
                candidate_id=f"item-{index:04d}",
                source_candidate_ids=[candidate.candidate_id],
                category=candidate.category,
                action=candidate.action,
                instruction_text=candidate.instruction_text,
                action_text=candidate.action_text,
                context=candidate.context,
                evidence_span_ids=candidate.evidence_span_ids,
                fields=candidate.fields,
                schedule=candidate.schedule,
                review_status="needs_review",
                disagreement_notes=[],
            )
            for index, candidate in enumerate(run.extraction.candidates, start=1)
        ],
        uncovered_source_span_ids=[],
        general_notes=["No evaluator ran; every item comes from a single extractor."],
    )


def run_pipeline(
    document_path: Path,
    run_root: Path,
    extractor_models: list[str],
    evaluator_model: str,
    vision_ocr_model: str,
    vision_fallback_confidence: float = 0.70,
    prepare_only: bool = False,
) -> Path:
    created_at = datetime.now(UTC)
    run_id = (
        f"{created_at.strftime('%Y%m%dT%H%M%S%fZ')}-"
        f"{_safe_filename(document_path.stem)[:30]}"
    )
    run_dir = run_root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    started_at = perf_counter()
    logger.info("Document preparation started")
    try:
        document = prepare_document(document_path, run_dir)
    except Exception as error:
        _save_json(
            run_dir / "error.json",
            {"type": type(error).__name__, "message": str(error)},
        )
        raise
    scanned_pages = sum(page.kind == "scanned" for page in document.pages)
    logger.info(
        "Document preparation completed: pages=%d scanned_pages=%d duration=%.1fs",
        len(document.pages),
        scanned_pages,
        perf_counter() - started_at,
    )
    # Scanned pages are read by the NEAR AI TEE vision model below; no page leaves for an OCR service.
    extractor = None if prepare_only else NearAIExtractor()
    if extractor:
        _apply_vision_ocr(
            document,
            run_dir,
            extractor,
            vision_ocr_model,
            vision_fallback_confidence,
        )

    if not evaluator_model:
        # No evaluator: one extractor's candidates go straight to human review.
        extractor_models = extractor_models[:1]
    manifest = RunManifest(
        run_id=run_id,
        document_id=document.document_id,
        document_sha256=document.sha256,
        document_kind=document.kind,
        llm_provider="near_ai",
        vision_ocr_model="" if prepare_only else vision_ocr_model,
        extractor_models=[] if prepare_only else extractor_models,
        evaluator_model="" if prepare_only else evaluator_model,
    )
    _save_json(run_dir / "manifest.json", manifest.model_dump(mode="json"))

    if prepare_only:
        return run_dir

    assert extractor is not None
    if len(extractor_models) < 2:
        logger.warning(
            "Only one extractor model is configured; final items will require review."
        )
    model_runs: list[ModelRun] = []
    source_candidate_ids: set[str] = set()

    for model_index, model in enumerate(extractor_models, start=1):
        started_at = perf_counter()
        logger.info(
            "Extractor started: model=%s position=%d/%d",
            model,
            model_index,
            len(extractor_models),
        )
        extraction = _clean_span_ids(extractor.extract(model, document, run_dir))
        resolved_model = getattr(extractor, "last_model", "") or model
        provider = extractor.last_provider
        for candidate_index, candidate in enumerate(extraction.candidates, start=1):
            candidate.candidate_id = f"m{model_index:02d}-c{candidate_index:04d}"
            source_candidate_ids.add(candidate.candidate_id)
        model_run = ModelRun(
            model=model,
            resolved_model=resolved_model,
            provider=provider,
            extraction=extraction,
            provenance_issues=validate_extraction(extraction, document),
        )
        model_runs.append(model_run)
        logger.info(
            "Extractor completed: model=%s resolved_model=%s candidates=%d provenance_issues=%d duration=%.1fs",
            model,
            resolved_model,
            len(extraction.candidates),
            len(model_run.provenance_issues),
            perf_counter() - started_at,
        )
        _save_json(
            run_dir / "extractors" / f"{_safe_filename(model)}.json",
            model_run.model_dump(mode="json"),
        )

    started_at = perf_counter()
    if evaluator_model:
        logger.info("Evaluator started: model=%s", evaluator_model)
        evaluation = extractor.evaluate(evaluator_model, document, model_runs, run_dir)
        resolved_evaluator_model = (
            getattr(extractor, "last_model", "") or evaluator_model
        )
        evaluator_provider = extractor.last_provider
    else:
        logger.info("Evaluator skipped: using the single extractor's candidates")
        evaluation = _unevaluated(model_runs[0])
        resolved_evaluator_model = ""
        evaluator_provider = ""
    _apply_review_policy(evaluation, document, model_runs)
    evaluation_issues = validate_evaluation(
        evaluation, document, source_candidate_ids
    )
    logger.info(
        "Evaluator completed: resolved_model=%s candidates=%d provenance_issues=%d duration=%.1fs",
        resolved_evaluator_model,
        len(evaluation.candidates),
        len(evaluation_issues),
        perf_counter() - started_at,
    )
    _save_json(
        run_dir / "evaluation.json",
        {
            "model": evaluator_model,
            "resolved_model": resolved_evaluator_model,
            "provider": evaluator_provider,
            "result": evaluation.model_dump(mode="json"),
            "provenance_issues": evaluation_issues,
        },
    )
    # NEAR AI TEE proofs for every model call in this run, including the Intel quotes.
    if isinstance(extractor, NearAIExtractor):
        _save_json(run_dir / "ai-attestations.json", extractor.attestations)
    started_at = perf_counter()
    logger.info("Review artifact rendering started")
    render_review_artifacts(document, evaluation, run_dir)
    logger.info(
        "Review artifact rendering completed: duration=%.1fs",
        perf_counter() - started_at,
    )
    return run_dir
