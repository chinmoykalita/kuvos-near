"""Offline checks for the NEAR AI extraction path (no network, synthetic values only).
Run: .venv/bin/python -m kuvos_worker.near_ai_check
"""

from kuvos_worker.models import (
    ExtractedCandidate,
    ExtractedField,
    ModelExtraction,
    ModelRun,
    ScheduleDraft,
    VisionPageTranscription,
)
from kuvos_worker.near_ai_adapter import _json_text, _strict_schema
from kuvos_worker.pipeline import (
    _apply_review_policy,
    _clean_span_ids,
    _unevaluated,
    _vision_boxes,
)
from kuvos_worker.prompts import EXTRACTION_PROMPT


def schedule(**overrides) -> dict:
    value = dict(
        kind="times_per_day", raw_text="", times=[], count=0, interval_hours=0,
        days_of_week=[], date="", start_date="", end_date="", duration_days=0,
        needs_user_input=False, evidence_span_ids=[],
    )
    value.update(overrides)
    return value


def candidate(candidate_id: str, category: str, text: str, **schedule_values) -> ExtractedCandidate:
    return ExtractedCandidate(
        candidate_id=candidate_id, category=category, action="perform",
        instruction_text=text, action_text=text, context="",
        evidence_span_ids=["[p0001-s0001]"],
        fields=[
            ExtractedField(name="dose", raw_value="1 tab", normalized_value="1 tablet", unit="",
                           evidence_span_ids=[" [p0001-s0001] "]),
            ExtractedField(name="route", raw_value="oral", normalized_value="oral", unit="",
                           evidence_span_ids=[]),
        ],
        schedule=ScheduleDraft.model_validate(schedule(evidence_span_ids=["[p0001-s0001]"], **schedule_values)),
    )


# JSON helpers: fenced replies and strict schemas.
assert _json_text('```json\n{"a": 1}\n```') == '{"a": 1}'
assert _json_text('  {"a": 1} ') == '{"a": 1}'
strict = _strict_schema(VisionPageTranscription.model_json_schema())
assert strict["additionalProperties"] is False
assert all(
    definition.get("additionalProperties") is False
    for definition in strict.get("$defs", {}).values()
    if definition.get("type") == "object"
)
assert "{spans}" in EXTRACTION_PROMPT and "{document_kind}" in EXTRACTION_PROMPT

# Only explicit clock times and ISO dates survive; words stay in raw_text.
draft = ScheduleDraft.model_validate(
    schedule(raw_text="OD (morning)", times=["morning", "08:00", "24:00", "after food"],
             date="after 4 weeks", start_date="2026-09-12")
)
assert draft.times == ["08:00"] and draft.date == "" and draft.start_date == "2026-09-12"

# Vision boxes: either coordinate order gives horizontal text lines.
for boxes in ([[41, 194, 62, 558], [680, 48, 700, 470]], [[194, 41, 558, 62], [48, 680, 470, 700]]):
    first = _vision_boxes(boxes)[0]
    assert (round(first.x, 3), round(first.y, 3)) == (0.194, 0.041) and first.width > first.height

# Span IDs lose wrapping brackets; fields with no evidence are dropped.
extraction = _clean_span_ids(
    ModelExtraction(
        document_category="prescription", document_context=[], unresolved=[],
        candidates=[
            candidate("c1", "medication", "Tab Paracetamol 650 mg SOS for pain", raw_text="SOS", times=["08:00"]),
            candidate("c2", "restriction", "Avoid climbing stairs", kind="interval"),
            candidate("c3", "exercise", "Walk 30 minutes daily", raw_text="daily"),
        ],
    )
)
first = extraction.candidates[0]
assert first.evidence_span_ids == ["p0001-s0001"] and first.schedule.evidence_span_ids == ["p0001-s0001"]
assert [field.name for field in first.fields] == ["dose"] and first.fields[0].evidence_span_ids == ["p0001-s0001"]

# No evaluator: every item comes from one extractor and is marked for review; the document's own
# wording decides SOS (as needed) and restrictions (persistent).
run = ModelRun(model="Qwen/Qwen3.6-35B-A3B-FP8", extraction=extraction, provenance_issues=[])
evaluation = _unevaluated(run)
assert [item.candidate_id for item in evaluation.candidates] == ["item-0001", "item-0002", "item-0003"]


class Document:
    source_spans: list = []


_apply_review_policy(evaluation, Document(), [run])
kinds = {item.category: item.schedule.kind for item in evaluation.candidates}
assert kinds == {"medication": "as_needed", "restriction": "persistent", "exercise": "times_per_day"}
assert evaluation.candidates[0].schedule.times == []
assert all(item.review_status == "needs_review" for item in evaluation.candidates)
assert all(
    "Fewer than two independent extractor models support this item." in item.disagreement_notes
    for item in evaluation.candidates
)

print("NEAR AI extraction checks passed: JSON and strict schema helpers, clock-time and date filtering, "
      "vision box orientation, span cleanup, unsupported fields dropped, single-extractor review, SOS and restrictions.")
