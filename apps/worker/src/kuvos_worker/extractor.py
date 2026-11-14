from pathlib import Path
from pydantic import BaseModel, Field

from kuvos_worker.pipeline import run_pipeline


class ExtractionRequest(BaseModel):
    document_path: Path
    run_root: Path
    extractor_models: list[str]
    evaluator_model: str
    vision_ocr_model: str
    vision_fallback_confidence: float = Field(default=0.70, ge=0, le=1)
    prepare_only: bool = False


class ExtractionResponse(BaseModel):
    run_id: str
    run_dir: Path
    manifest_path: Path
    evaluation_path: Path | None


def extract_document(request: ExtractionRequest) -> ExtractionResponse:
    run_dir = run_pipeline(
        document_path=request.document_path,
        run_root=request.run_root,
        extractor_models=request.extractor_models,
        evaluator_model=request.evaluator_model,
        vision_ocr_model=request.vision_ocr_model,
        vision_fallback_confidence=request.vision_fallback_confidence,
        prepare_only=request.prepare_only,
    )
    evaluation_path = run_dir / "evaluation.json"
    return ExtractionResponse(
        run_id=run_dir.name,
        run_dir=run_dir,
        manifest_path=run_dir / "manifest.json",
        evaluation_path=evaluation_path if evaluation_path.exists() else None,
    )
