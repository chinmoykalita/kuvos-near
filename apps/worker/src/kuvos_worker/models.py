from datetime import UTC, datetime
from typing import Literal

import re

from pydantic import BaseModel, Field, field_validator


DocumentKind = Literal["digital", "scanned", "mixed"]
PageKind = Literal["digital", "scanned"]
SourceMethod = Literal["embedded_text", "ocr", "vision_ocr"]
CandidateCategory = Literal[
    "medication",
    "exercise",
    "restriction",
    "care_task",
    "follow_up",
    "monitoring",
    "other_instruction",
]
ScheduleKind = Literal[
    "exact_times",
    "times_per_day",
    "interval",
    "weekly",
    "once",
    "as_needed",
    "persistent",
    "unknown",
]


class BoundingBox(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)


class SourceSpan(BaseModel):
    span_id: str
    page: int = Field(ge=1)
    text: str
    bounding_box: BoundingBox
    method: SourceMethod
    confidence: float = Field(ge=0, le=1)
    text_type: Literal["PRINTED", "HANDWRITING", "UNKNOWN"] = "UNKNOWN"
    provider_block_id: str = ""
    provider_job_id: str = ""


class PreparedPage(BaseModel):
    page: int = Field(ge=1)
    kind: PageKind
    image_path: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    source_span_ids: list[str]


class PreparedDocument(BaseModel):
    schema_version: str = "1.0"
    document_id: str
    original_path: str
    sha256: str
    kind: DocumentKind
    pages: list[PreparedPage]
    source_spans: list[SourceSpan]


class ExtractedField(BaseModel):
    name: str = Field(description="Stable snake_case field name.")
    raw_value: str = Field(description="Exact value as written in the cited source.")
    normalized_value: str = Field(
        description="Normalized value without adding information not present in the source."
    )
    unit: str = Field(description="Unit as written, or an empty string.")
    evidence_span_ids: list[str] = Field(
        description="Source span IDs that directly support this field."
    )


_CLOCK_TIME = re.compile(r"([01]\d|2[0-3]):[0-5]\d")
_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


class ScheduleDraft(BaseModel):
    kind: ScheduleKind
    raw_text: str = Field(description="Exact scheduling phrase from the source.")
    times: list[str] = Field(description="Explicit HH:MM times only; never guessed.")
    count: int = Field(description="Times per day, or 0 when absent.", ge=0)
    interval_hours: float = Field(
        description="Hour interval, or 0 when absent.", ge=0
    )
    days_of_week: list[str]
    date: str = Field(description="Explicit YYYY-MM-DD date, or an empty string.")
    start_date: str = Field(
        description="Explicit YYYY-MM-DD start date, or an empty string."
    )
    end_date: str = Field(
        description="Explicit YYYY-MM-DD end date, or an empty string."
    )
    duration_days: int = Field(description="Explicit duration in days, or 0.", ge=0)
    needs_user_input: bool
    evidence_span_ids: list[str]

    # Models sometimes put words ("morning", "after food") or phrases ("after 4 weeks") here.
    # Those stay in raw_text and the instruction; only explicit clock times and dates survive,
    # so the reviewer is asked to choose them instead of a guess becoming a reminder.
    @field_validator("times", mode="before")
    @classmethod
    def _clock_times(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        return [time for time in value if isinstance(time, str) and _CLOCK_TIME.fullmatch(time)]

    @field_validator("date", "start_date", "end_date", mode="before")
    @classmethod
    def _iso_date(cls, value: object) -> object:
        return value if not isinstance(value, str) or _ISO_DATE.fullmatch(value) else ""


class ExtractedCandidate(BaseModel):
    candidate_id: str = Field(description="Unique ID within this model response.")
    category: CandidateCategory
    action: Literal[
        "start",
        "continue",
        "stop",
        "change",
        "perform",
        "avoid",
        "attend",
        "monitor",
        "unknown",
    ]
    instruction_text: str = Field(
        description="Complete instruction, preserving conditions and qualifiers."
    )
    action_text: str = Field(
        description="Concise action for Today; omit recurrence and duration but retain dose, meal relation, condition, reps, hold, and other execution details."
    )
    context: str = Field(
        description="Relevant section or adjacent context, or an empty string."
    )
    evidence_span_ids: list[str] = Field(
        description="All source spans supporting the complete instruction."
    )
    fields: list[ExtractedField]
    schedule: ScheduleDraft


class UnresolvedInstruction(BaseModel):
    text: str
    reason: str
    evidence_span_ids: list[str]


class ModelExtraction(BaseModel):
    document_category: str
    document_context: list[ExtractedField]
    candidates: list[ExtractedCandidate]
    unresolved: list[UnresolvedInstruction]


class VisionLine(BaseModel):
    text: str = Field(
        description="Verbatim text from one visual line; use [unclear] for unreadable parts."
    )
    box_2d: list[int] = Field(
        min_length=4,
        max_length=4,
        description="[ymin, xmin, ymax, xmax] coordinates normalized to 0-1000.",
    )
    clarity: Literal["clear", "uncertain"]


class VisionPageTranscription(BaseModel):
    lines: list[VisionLine]


class ModelRun(BaseModel):
    model: str
    resolved_model: str = ""
    provider: str = ""
    extraction: ModelExtraction
    provenance_issues: list[str]


class ExplanationSource(BaseModel):
    title: str = ""
    url: str = ""
    quote: str = ""
    evidence_span_ids: list[str] = Field(default_factory=list)


class Explanation(BaseModel):
    text: str = Field(default="", max_length=1200)
    sources: list[ExplanationSource] = Field(default_factory=list, max_length=3)


class EvaluatedCandidate(BaseModel):
    candidate_id: str
    source_candidate_ids: list[str] = Field(
        description="Candidate IDs from the independent model runs used here."
    )
    category: CandidateCategory
    action: str
    instruction_text: str
    action_text: str
    context: str
    evidence_span_ids: list[str]
    fields: list[ExtractedField]
    schedule: ScheduleDraft
    review_status: Literal["supported", "needs_review", "unsupported"]
    disagreement_notes: list[str]
    explanation: Explanation = Field(default_factory=Explanation)


class EvaluationResult(BaseModel):
    candidates: list[EvaluatedCandidate]
    uncovered_source_span_ids: list[str]
    general_notes: list[str]
    suggested_plan_name: str = Field(
        default="",
        description=(
            "Short operational label for the care plan folder, 3-40 characters, "
            "taken only from a supported heading, department, specialty, clinic, "
            "or dominant instruction category. Empty when nothing in the source "
            "supports a label. Not a diagnosis."
        ),
    )


class RunManifest(BaseModel):
    schema_version: str = "1.4"
    run_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    document_id: str
    document_sha256: str
    document_kind: DocumentKind
    llm_provider: str
    vision_ocr_model: str
    extractor_models: list[str]
    evaluator_model: str
