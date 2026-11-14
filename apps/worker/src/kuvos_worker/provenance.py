import re

from kuvos_worker.models import (
    EvaluationResult,
    ModelExtraction,
    PreparedDocument,
)


def _normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def validate_extraction(
    extraction: ModelExtraction, document: PreparedDocument
) -> list[str]:
    spans = {span.span_id: span for span in document.source_spans}
    issues: list[str] = []

    for candidate in extraction.candidates:
        if not candidate.action_text.strip():
            issues.append(f"{candidate.candidate_id}: action text is empty")
        if not candidate.evidence_span_ids:
            issues.append(f"{candidate.candidate_id}: instruction has no source evidence")
        for span_id in candidate.evidence_span_ids:
            if span_id not in spans:
                issues.append(f"{candidate.candidate_id}: unknown span {span_id}")

        for field in candidate.fields:
            if not field.evidence_span_ids:
                issues.append(
                    f"{candidate.candidate_id}.{field.name}: field has no source evidence"
                )
                continue
            field_text = " ".join(
                spans[span_id].text
                for span_id in field.evidence_span_ids
                if span_id in spans
            )
            for span_id in field.evidence_span_ids:
                if span_id not in spans:
                    issues.append(
                        f"{candidate.candidate_id}.{field.name}: unknown span {span_id}"
                    )
            if field.raw_value and _normalized(field.raw_value) not in _normalized(field_text):
                issues.append(
                    f"{candidate.candidate_id}.{field.name}: raw value is not present in cited spans"
                )
        for span_id in candidate.schedule.evidence_span_ids:
            if span_id not in spans:
                issues.append(
                    f"{candidate.candidate_id}.schedule: unknown span {span_id}"
                )

    return issues


def validate_evaluation(
    evaluation: EvaluationResult,
    document: PreparedDocument,
    source_candidate_ids: set[str],
) -> list[str]:
    span_ids = {span.span_id for span in document.source_spans}
    issues: list[str] = []
    for candidate in evaluation.candidates:
        if not candidate.action_text.strip():
            issues.append(f"{candidate.candidate_id}: action text is empty")
        for source_candidate_id in candidate.source_candidate_ids:
            if source_candidate_id not in source_candidate_ids:
                issues.append(
                    f"{candidate.candidate_id}: unknown source candidate {source_candidate_id}"
                )
        for span_id in candidate.evidence_span_ids:
            if span_id not in span_ids:
                issues.append(f"{candidate.candidate_id}: unknown span {span_id}")
        for field in candidate.fields:
            for span_id in field.evidence_span_ids:
                if span_id not in span_ids:
                    issues.append(
                        f"{candidate.candidate_id}.{field.name}: unknown span {span_id}"
                    )
        for span_id in candidate.schedule.evidence_span_ids:
            if span_id not in span_ids:
                issues.append(
                    f"{candidate.candidate_id}.schedule: unknown span {span_id}"
                )
    return issues
