import hashlib
import json
from pathlib import Path
from typing import Any

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image

from kuvos_worker.models import (
    BoundingBox,
    PreparedDocument,
    PreparedPage,
    SourceSpan,
)


DIGITAL_MIN_CHARACTERS = 30
DIGITAL_MIN_WORDS = 4
PDF_RENDER_SCALE = 2.5


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalized_box(
    left: float,
    top: float,
    right: float,
    bottom: float,
    width: float,
    height: float,
) -> BoundingBox:
    return BoundingBox(
        x=max(0, min(1, left / width)),
        y=max(0, min(1, top / height)),
        width=max(0, min(1, (right - left) / width)),
        height=max(0, min(1, (bottom - top) / height)),
    )


def _group_pdf_words(words: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    lines: list[list[dict[str, Any]]] = []
    for word in sorted(words, key=lambda item: (round(item["top"] / 3), item["x0"])):
        for line in lines:
            if abs(line[0]["top"] - word["top"]) <= 3:
                line.append(word)
                break
        else:
            lines.append([word])
    return [sorted(line, key=lambda item: item["x0"]) for line in lines]


def _embedded_spans(
    page_number: int,
    words: list[dict[str, Any]],
    page_width: float,
    page_height: float,
) -> list[SourceSpan]:
    spans: list[SourceSpan] = []
    for index, line in enumerate(_group_pdf_words(words), start=1):
        text = " ".join(str(word["text"]) for word in line).strip()
        if not text:
            continue
        spans.append(
            SourceSpan(
                span_id=f"p{page_number:04d}-s{index:04d}",
                page=page_number,
                text=text,
                bounding_box=_normalized_box(
                    min(word["x0"] for word in line),
                    min(word["top"] for word in line),
                    max(word["x1"] for word in line),
                    max(word["bottom"] for word in line),
                    page_width,
                    page_height,
                ),
                method="embedded_text",
                confidence=1,
            )
        )
    return spans


def _save_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def prepare_document(source_path: Path, run_dir: Path) -> PreparedDocument:
    source_path = source_path.resolve()
    if not source_path.is_file():
        raise FileNotFoundError(f"Document not found: {source_path}")

    file_hash = _sha256(source_path)
    document_id = f"doc-{file_hash[:16]}"
    page_dir = run_dir / "pages"
    page_dir.mkdir(parents=True, exist_ok=True)

    pages: list[PreparedPage] = []
    all_spans: list[SourceSpan] = []
    suffix = source_path.suffix.lower()

    if suffix == ".pdf":
        rendered_pdf = pdfium.PdfDocument(source_path)
        with pdfplumber.open(source_path) as text_pdf:
            for page_index, text_page in enumerate(text_pdf.pages):
                page_number = page_index + 1
                image = rendered_pdf[page_index].render(scale=PDF_RENDER_SCALE).to_pil()
                image_path = page_dir / f"page-{page_number:04d}.png"
                image.save(image_path)

                words = text_page.extract_words(keep_blank_chars=False, use_text_flow=True)
                embedded_characters = sum(len(str(word["text"])) for word in words)
                is_digital = (
                    len(words) >= DIGITAL_MIN_WORDS
                    and embedded_characters >= DIGITAL_MIN_CHARACTERS
                )
                spans = (
                    _embedded_spans(
                        page_number,
                        words,
                        float(text_page.width),
                        float(text_page.height),
                    )
                    if is_digital
                    else []
                )
                all_spans.extend(spans)
                pages.append(
                    PreparedPage(
                        page=page_number,
                        kind="digital" if is_digital else "scanned",
                        image_path=str(image_path.relative_to(run_dir)),
                        width=image.width,
                        height=image.height,
                        source_span_ids=[span.span_id for span in spans],
                    )
                )
    elif suffix in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        with Image.open(source_path) as source_image:
            frame_count = (
                int(getattr(source_image, "n_frames", 1))
                if suffix in {".tif", ".tiff"}
                else 1
            )
            for page_number in range(1, frame_count + 1):
                source_image.seek(page_number - 1)
                image = source_image.convert("RGB")
                image_path = page_dir / f"page-{page_number:04d}.png"
                image.save(image_path)
                pages.append(
                    PreparedPage(
                        page=page_number,
                        kind="scanned",
                        image_path=str(image_path.relative_to(run_dir)),
                        width=image.width,
                        height=image.height,
                        source_span_ids=[],
                    )
                )
    else:
        raise ValueError(
            "Supported document types are PDF, PNG, JPG, JPEG, TIF, and TIFF."
        )

    page_kinds = {page.kind for page in pages}
    document_kind = (
        "mixed"
        if len(page_kinds) > 1
        else "digital"
        if page_kinds == {"digital"}
        else "scanned"
    )
    prepared = PreparedDocument(
        document_id=document_id,
        original_path=str(source_path),
        sha256=file_hash,
        kind=document_kind,
        pages=pages,
        source_spans=all_spans,
    )
    _save_json(run_dir / "document.json", prepared.model_dump(mode="json"))
    return prepared
