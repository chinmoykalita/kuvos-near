"""Prompts for the NEAR AI Cloud extraction pipeline (extract, evaluate, page transcription)."""

from kuvos_worker.models import PreparedDocument


EXTRACTION_PROMPT = """You extract recovery-plan instructions from a healthcare document.

Rules:
- Extract every actionable medication, exercise, restriction, care task, follow-up,
  monitoring instruction, and other instruction.
- Do not provide medical advice and do not add facts absent from the source.
- Preserve stop/start/continue/change actions, conditions, negations, dates, durations,
  frequencies, sides, doses, routes, food instructions, and provider details.
- Create action_text as the concise imperative shown when the task is due. Remove
  recurrence, duration, and clock-time wording because the schedule supplies it. Keep
  execution details such as dose, route, before/after food, condition, reps, sets,
  hold time, and safety cues. Example: "Change wound dressing once daily every
  morning" becomes "Change wound dressing".
- Every candidate and every field must cite source span IDs from the input.
- Create a schedule draft for every candidate. Preserve the exact timing phrase and
  its evidence. Never invent clock times. Set needs_user_input when a phrase such as
  TDS or twice daily requires the caregiver to choose actual times. Use 0, empty
  strings, or empty lists for schedule values absent from the source.
- Use kind "interval" only when the source states an hour gap, such as Q6H or every
  8 hours, and set interval_hours from that gap. OD, BD, TDS, daily, twice daily,
  and similar counts are "times_per_day" with count set and interval_hours 0.
  A single appointment or review is "once".
- Set duration_days only from an explicit duration in the source, or from explicit
  start and end dates. Convert weeks to days only when the source states weeks
  (1 week = 7 days). Leave duration_days as 0 when the document does not say how
  long the instruction continues. Do not guess a course length.
- raw_value must be copied exactly from the cited span. normalized_value may standardize
  formatting but must not add meaning.
- If text appears actionable but cannot be safely interpreted, put it in unresolved.

Document kind: {document_kind}
Canonical source spans:
{spans}

Rendered page images follow in page order when the document contains scanned pages.
"""


EVALUATION_PROMPT = """You evaluate independent extractions of a healthcare document.

The source spans are authoritative; model agreement alone is not proof.
Combine duplicate candidates only when they describe the same instruction. Preserve
separate instructions when dose, action, timing, or source context differs.
Use only values supported by cited spans. Mark critical disagreements, ambiguity,
missing evidence, and unreadable text as needs_review or unsupported. Do not invent
new instructions. Each final candidate must retain source_candidate_ids and evidence
span IDs. Preserve and reconcile action_text and schedule drafts without inventing
clock times.

Leave explanation text and sources empty; explanation enrichment is disabled.

Also set suggested_plan_name: a short operational folder label (3-40 characters)
such as Cardiac, Physio, or Dental. Take it only from a supported heading,
department, specialty, clinic name, or the dominant instruction category in the
source. Leave it empty when nothing in the source supports a label. Do not invent
a clinical title, diagnosis, or doctor name.

Canonical source spans:
{spans}

Independent model runs:
{model_runs}

Rendered page images follow in page order when the document contains scanned pages.
"""


VISION_TRANSCRIPTION_PROMPT = """Transcribe every visible text line in this healthcare document image.

Return one line object per visual line in reading order. Preserve the original language,
medicine names, abbreviations, numbers, doses, frequencies, dates, and punctuation as
closely as possible. Do not translate, normalize, complete, or clinically interpret text.
Use [unclear] for unreadable portions rather than guessing.

For every line, return box_2d as [ymin, xmin, ymax, xmax], normalized to 0-1000.
Mark clarity uncertain if any clinically meaningful part of that line is hard to read.
"""


def _spans_text(document: PreparedDocument) -> str:
    return "\n".join(
        f"[{span.span_id}] page={span.page} method={span.method} text={span.text}"
        for span in document.source_spans
    )

