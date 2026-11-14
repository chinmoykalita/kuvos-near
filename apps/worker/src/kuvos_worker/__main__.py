import argparse
import logging
import os
import signal
import threading
from pathlib import Path

from dotenv import load_dotenv


def _model_env(role: str) -> str:
    from kuvos_worker.jobs import _model

    return _model(role)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Kuvos NEAR extraction worker.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate the worker configuration and exit.",
    )
    parser.add_argument(
        "document",
        nargs="?",
        type=Path,
        help="PDF, PNG, JPG, JPEG, TIF, or TIFF document to process.",
    )
    parser.add_argument(
        "--prepare-only",
        action="store_true",
        help="Classify, render, and OCR the document without calling a model.",
    )
    parser.add_argument(
        "--models",
        default=None,
        help="Comma-separated NEAR AI Cloud extractor model IDs.",
    )
    parser.add_argument(
        "--vision-ocr-model",
        default=None,
        help="NEAR AI Cloud vision model that reads scanned pages.",
    )
    parser.add_argument(
        "--vision-fallback-confidence",
        type=float,
        default=float(os.getenv("VISION_FALLBACK_CONFIDENCE", "0.70")),
        help="Use vision OCR when a page's embedded text confidence is below this value.",
    )
    parser.add_argument(
        "--evaluator-model",
        default=None,
        help="NEAR AI Cloud evaluator model (empty: no evaluator).",
    )
    parser.add_argument(
        "--run-root",
        type=Path,
        help="Directory where extraction run artifacts are written.",
    )
    args = parser.parse_args()
    args.models = args.models if args.models is not None else _model_env("EXTRACTOR_MODELS")
    args.vision_ocr_model = (
        args.vision_ocr_model
        if args.vision_ocr_model is not None
        else _model_env("VISION_OCR_MODEL")
    )
    args.evaluator_model = (
        args.evaluator_model
        if args.evaluator_model is not None
        else _model_env("EVALUATOR_MODEL")
    )
    return args


def main() -> None:
    load_dotenv()
    args = parse_args()
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    logger = logging.getLogger("kuvos_worker")

    data_dir = Path(os.getenv("KUVOS_DATA_DIR", "data")).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    if args.check:
        logger.info("Worker configuration is valid; data directory: %s", data_dir)
        return

    if args.document:
        from kuvos_worker.extractor import ExtractionRequest, extract_document

        models = [model.strip() for model in args.models.split(",") if model.strip()]
        if not args.prepare_only and not models:
            raise SystemExit("At least one extractor model is required.")
        response = extract_document(
            ExtractionRequest(
                document_path=args.document,
                run_root=(args.run_root or data_dir / "runs").resolve(),
                extractor_models=models,
                evaluator_model=args.evaluator_model,
                vision_ocr_model=args.vision_ocr_model,
                vision_fallback_confidence=args.vision_fallback_confidence,
                prepare_only=args.prepare_only,
            )
        )
        logger.info("Extraction run written to %s", response.run_dir)
        return

    stopped = threading.Event()

    def stop_worker(signum: int, _frame: object) -> None:
        logger.info("Received signal %s; stopping worker", signum)
        stopped.set()

    signal.signal(signal.SIGTERM, stop_worker)
    signal.signal(signal.SIGINT, stop_worker)

    logger.info("Kuvos NEAR worker is ready; data directory: %s", data_dir)
    from kuvos_worker.jobs import run_job_loop

    run_job_loop(stopped, data_dir)


if __name__ == "__main__":
    main()
