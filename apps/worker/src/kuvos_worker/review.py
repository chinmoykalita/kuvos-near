import html
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from kuvos_worker.models import EvaluationResult, PreparedDocument, SourceSpan


COLORS = [(205, 63, 63), (31, 112, 184), (32, 133, 83), (177, 112, 24), (130, 74, 166)]


def _pixel_box(span: SourceSpan, image: Image.Image) -> tuple[int, int, int, int]:
    box = span.bounding_box
    left, top = round(box.x * image.width), round(box.y * image.height)
    right = round((box.x + box.width) * image.width)
    bottom = round((box.y + box.height) * image.height)
    return left, top, max(left + 1, right), max(top + 1, bottom)


def _label(draw: ImageDraw.ImageDraw, text: str, left: int, top: int, color: tuple[int, int, int], font: ImageFont.ImageFont) -> None:
    bounds = draw.textbbox((0, 0), text, font=font)
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    label_top = max(0, top - height - 4)
    draw.rectangle((left, label_top, left + width + 8, label_top + height + 4), fill=color)
    draw.text((left + 4, label_top + 2), text, fill="white", font=font)


def _marked_page(image: Image.Image, spans: dict[str, SourceSpan], candidate_spans: dict[str, list[str]]) -> Image.Image:
    output = image.convert("RGB").copy()
    draw, font = ImageDraw.Draw(output), ImageFont.load_default()
    usage: dict[str, int] = {}
    for span_ids in candidate_spans.values():
        for span_id in set(span_ids):
            usage[span_id] = usage.get(span_id, 0) + 1
    shared_seen: set[str] = set()
    for index, (candidate_id, span_ids) in enumerate(candidate_spans.items()):
        color = COLORS[index % len(COLORS)]
        for span_id in span_ids:
            span = spans.get(span_id)
            if span is None:
                continue
            left, top, right, bottom = _pixel_box(span, output)
            if usage.get(span_id, 0) > 1:
                if span_id in shared_seen:
                    continue
                shared_seen.add(span_id)
                draw.rectangle((left, top, right, bottom), outline=(96, 96, 96), width=5)
                _label(draw, "shared", left, top, (96, 96, 96), font)
            else:
                draw.rectangle((left, top, right, bottom), outline=color, width=5)
                _label(draw, candidate_id, left, top, color, font)
    return output


def _crop(image: Image.Image, spans: list[SourceSpan], candidate_id: str, color: tuple[int, int, int]) -> Image.Image:
    boxes = [_pixel_box(span, image) for span in spans]
    left = max(0, min(box[0] for box in boxes) - 32)
    top = max(0, min(box[1] for box in boxes) - 32)
    right = min(image.width, max(box[2] for box in boxes) + 32)
    bottom = min(image.height, max(box[3] for box in boxes) + 32)
    output = image.convert("RGB").crop((left, top, right, bottom))
    draw = ImageDraw.Draw(output)
    for span in spans:
        span_left, span_top, span_right, span_bottom = _pixel_box(span, image)
        draw.rectangle((span_left - left, span_top - top, span_right - left, span_bottom - top), outline=color, width=5)
    _label(draw, candidate_id, 8, 8, color, ImageFont.load_default())
    return output


def _write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")


def render_review_artifacts(document: PreparedDocument, evaluation: EvaluationResult, run_dir: Path) -> Path:
    evidence_dir, pages_dir, candidates_dir = run_dir / "evidence", run_dir / "evidence/pages", run_dir / "evidence/candidates"
    pages_dir.mkdir(parents=True, exist_ok=True)
    candidates_dir.mkdir(parents=True, exist_ok=True)
    span_by_id = {span.span_id: span for span in document.source_spans}
    page_by_number = {page.page: page for page in document.pages}
    spans_by_page: dict[int, dict[str, list[str]]] = {}
    candidate_pages: dict[str, list[int]] = {}
    for candidate in evaluation.candidates:
        for span_id in candidate.evidence_span_ids:
            span = span_by_id.get(span_id)
            if span is None:
                continue
            spans_by_page.setdefault(span.page, {}).setdefault(candidate.candidate_id, []).append(span_id)
            if span.page not in candidate_pages.setdefault(candidate.candidate_id, []):
                candidate_pages[candidate.candidate_id].append(span.page)

    marked_pages: dict[int, str] = {}
    for page_number, page in page_by_number.items():
        image_path = run_dir / page.image_path
        if not image_path.exists():
            continue
        with Image.open(image_path) as image:
            marked = _marked_page(image, {span.span_id: span for span in document.source_spans if span.page == page_number}, spans_by_page.get(page_number, {}))
            output_path = pages_dir / f"page-{page_number:04d}-marked.png"
            marked.save(output_path)
        marked_pages[page_number] = output_path.relative_to(evidence_dir).as_posix()

    candidate_images: dict[str, list[str]] = {}
    for index, candidate in enumerate(evaluation.candidates):
        color = COLORS[index % len(COLORS)]
        for page_number in candidate_pages.get(candidate.candidate_id, []):
            page = page_by_number[page_number]
            image_path = run_dir / page.image_path
            spans = [span_by_id[span_id] for span_id in candidate.evidence_span_ids if span_id in span_by_id and span_by_id[span_id].page == page_number]
            if not spans or not image_path.exists():
                continue
            with Image.open(image_path) as image:
                output_path = candidates_dir / f"{candidate.candidate_id}-page-{page_number:04d}.png"
                _crop(image, spans, candidate.candidate_id, color).save(output_path)
            candidate_images.setdefault(candidate.candidate_id, []).append(output_path.relative_to(evidence_dir).as_posix())

    cards: list[str] = []
    for candidate in evaluation.candidates:
        fields = "".join(f"<tr><td>{html.escape(field.name)}</td><td>{html.escape(field.raw_value)}</td><td><code>{html.escape(', '.join(field.evidence_span_ids))}</code></td></tr>" for field in candidate.fields)
        images = "".join(f'<img src="evidence/{html.escape(path)}" alt="{html.escape(candidate.candidate_id)} evidence crop">' for path in candidate_images.get(candidate.candidate_id, []))
        notes = "".join(f"<li>{html.escape(note)}</li>" for note in candidate.disagreement_notes)
        cards.append(f"<article><h2>{html.escape(candidate.candidate_id)} <small>{html.escape(candidate.review_status)}</small></h2><p>{html.escape(candidate.instruction_text)}</p><p>Evidence: <code>{html.escape(', '.join(candidate.evidence_span_ids))}</code></p><div class=\"crops\">{images or '<em>No crop available</em>'}</div><table><tr><th>Field</th><th>Raw value</th><th>Evidence</th></tr>{fields}</table>{f'<ul>{notes}</ul>' if notes else ''}</article>")
    pages_html = "".join(f'<figure><img src="evidence/{html.escape(path)}" alt="Marked page {page}"><figcaption>Page {page}</figcaption></figure>' for page, path in sorted(marked_pages.items()))
    report = f"""<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Kuvos extraction review</title><style>body{{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#1f2d2b}}img{{max-width:100%;max-height:900px;border:1px solid #ccd8d5}}.pages,.crops{{display:flex;flex-wrap:wrap;gap:1rem}}article{{margin:2rem 0;padding:1rem;border:1px solid #ccd8d5;border-radius:10px}}.crops img{{max-width:520px;max-height:420px;border:3px solid #f0c36a}}table{{border-collapse:collapse;width:100%;margin-top:1rem}}th,td{{border:1px solid #d8e0de;padding:.45rem;text-align:left}}th{{background:#f4f7f6}}small{{background:#fff1c7;padding:.25rem .5rem;border-radius:999px}}</style></head><body><h1>Kuvos extraction review</h1><p>Document kind: {html.escape(document.kind)} · Candidates: {len(evaluation.candidates)}</p><h2>Marked pages</h2><div class=\"pages\">{pages_html or '<em>No marked pages</em>'}</div><h2>Candidate evidence</h2>{''.join(cards) or '<em>No candidates</em>'}<h2>Uncovered source spans</h2><code>{html.escape(', '.join(evaluation.uncovered_source_span_ids) or 'None')}</code></body></html>"""
    report_path = run_dir / "review.html"
    report_path.write_text(report, encoding="utf-8")
    _write_json(evidence_dir / "index.json", {"review_html": "../review.html", "marked_pages": marked_pages, "candidate_crops": candidate_images})
    return report_path
