import type { Candidate, DailyRoutine, Extraction, Meal, ResumableExtraction, Schedule } from './api.ts';

export function resumeRoute(extraction: ResumableExtraction) {
  return {
    pathname:
      extraction.status === 'review_ready' ? '/review/[id]' : '/extraction/[id]',
    params: {
      id: extraction.id,
      ...(extraction.planId ? { planId: extraction.planId } : {}),
    },
  } as const;
}

export function resumeCandidateIndex(candidates: Candidate[]) {
  const index = candidates.findIndex((candidate) => !candidate.decision);
  return index < 0 ? 0 : index;
}

export function resolvedDurationDays(schedule?: Schedule) {
  if (!schedule) return 0;
  return scheduleDays(schedule);
}

export function candidatesFrom(extraction: Extraction): Candidate[] {
  const extracted = extraction.result?.evaluation?.candidates || [];
  const extractedById = new Map(
    extracted.map((candidate) => [candidate.candidate_id, candidate]),
  );
  const candidates = extraction.review?.candidates || extracted;
  return candidates.map((candidate) => {
    const extractedDays = resolvedDurationDays(
      extractedById.get(candidate.candidate_id)?.schedule,
    );
    const reviewedDays = Number(candidate.schedule?.duration_days || 0);
    const durationDays =
      Number.isInteger(reviewedDays) && reviewedDays > 0
        ? reviewedDays
        : extractedDays || resolvedDurationDays(candidate.schedule);
    return {
      ...candidate,
      action_text: candidate.action_text || candidate.instruction_text,
      evidence_span_ids: [...candidate.evidence_span_ids],
      fields: [...candidate.fields],
      extracted_duration_days: extractedDays || undefined,
      schedule: scheduleForReview(candidate.category, {
        ...(candidate.schedule || { kind: 'unknown' }),
        times: [...(candidate.schedule?.times || [])],
        duration_days: durationDays,
      }),
    };
  });
}

export function fieldValue(field: Candidate['fields'][number]) {
  const value = field.raw_value.trim();
  const unit = field.unit?.trim();
  return unit && !value.toLowerCase().endsWith(unit.toLowerCase()) ? `${value} ${unit}` : value;
}

export function isUnscheduled(candidate: Candidate) {
  return (
    candidate.category === 'restriction' ||
    ['as_needed', 'persistent'].includes(candidate.schedule.kind)
  );
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SCHEDULE_DAYS = 366;

export function needsDayCount(candidate: Candidate) {
  return !isUnscheduled(candidate) && candidate.schedule.kind !== 'once';
}

function scheduleDays(schedule: Schedule) {
  const requested = Number(schedule.duration_days || 0);
  if (Number.isInteger(requested) && requested > 0) return requested;
  const start = [schedule.date, schedule.start_date].find((value) =>
    DATE_ONLY.test(value || ''),
  );
  if (start && DATE_ONLY.test(schedule.end_date || '')) {
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${schedule.end_date}T00:00:00Z`);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      return Math.round((endMs - startMs) / 86_400_000) + 1;
    }
  }
  return 0;
}

export function needsIntervalCompletion(schedule: Schedule) {
  return (
    schedule.kind === 'interval' &&
    Number(schedule.interval_hours) > 0 &&
    schedule.times.length === 0
  );
}

function scheduleForReview(category: string | undefined, schedule: Schedule): Schedule {
  if (schedule.kind !== 'interval' || Number(schedule.interval_hours) > 0) return schedule;
  const count = Number(schedule.count || 0);
  if (Number.isInteger(count) && count > 0) return { ...schedule, kind: 'times_per_day' };
  if (category === 'follow_up') return { ...schedule, kind: 'once' };
  return schedule;
}

export function suggestedReminderSlots(schedule: Schedule) {
  if (['as_needed', 'persistent'].includes(schedule.kind)) return 0;
  if (needsIntervalCompletion(schedule)) return 0;
  if (schedule.kind === 'times_per_day') {
    const count = Number(schedule.count || 0);
    if (Number.isInteger(count) && count > 0) return count;
  }
  return Math.max(schedule.times.length, 1);
}

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner'];

function clockMinutes(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return hour * 60 + minute;
}

function clockTime(minutes: number) {
  const day = ((Math.round(minutes / 15) * 15) % 1440 + 1440) % 1440;
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`;
}

/**
 * Reminder-time suggestions from the patient's usual day, for items the document gives no clock
 * time. Meal-linked items land on the meal itself (never an invented offset); everything else is
 * spread across the waking window. The reviewer still confirms every time.
 */
export function routineTimes(candidate: Candidate, routine?: DailyRoutine): string[] {
  const { schedule } = candidate;
  if (!routine || schedule.times.length || isUnscheduled(candidate)) return [];
  if (['once', 'interval'].includes(schedule.kind)) return [];
  const count = suggestedReminderSlots(schedule);
  if (count < 1 || count > 6) return [];

  const meal = candidate.fields.find((field) => /meal|food/.test(field.name));
  if (meal) {
    const said = `${meal.raw_value} ${meal.normalized_value || ''}`.toLowerCase();
    if (/empty stomach/.test(said)) return [];
    const named = MEALS.filter((name) => said.includes(name) || (name === 'dinner' && said.includes('supper')));
    const times = (named.length ? named : MEALS).flatMap((name) => routine.meals[name] ?? []);
    if (count === times.length) return times;
    if (named.length || !times.length) return [];
    if (count === 1) return [times[0]];
    if (count === 2 && times.length === 3) return [times[0], times[2]];
    return [];
  }

  if (candidate.category === 'exercise' && routine.exercise && count === 1) return [routine.exercise];
  const wake = clockMinutes(routine.wake);
  let sleep = clockMinutes(routine.sleep);
  if (sleep <= wake) sleep += 1440;
  if (count === 1) return [routine.wake];
  const step = (sleep - wake) / (count - 1);
  return [...new Set(Array.from({ length: count }, (_, index) => clockTime(wake + step * index)))].sort();
}

export function emptyReminderSlots(schedule: Schedule) {
  return Math.max(0, suggestedReminderSlots(schedule) - schedule.times.length);
}

export function scheduleIssue(candidate: Candidate): string | undefined {
  if (isUnscheduled(candidate)) return;
  if (needsIntervalCompletion(candidate.schedule)) {
    return 'Interval timing needs backend completion before this item can be included.';
  }
  if (candidate.schedule.times.length === 0) return 'Choose at least one reminder time.';
  if (candidate.schedule.times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    return 'Choose a valid reminder time.';
  }
  if (new Set(candidate.schedule.times).size !== candidate.schedule.times.length) {
    return 'Choose a different time for each reminder.';
  }
  if (needsDayCount(candidate)) {
    const days = scheduleDays(candidate.schedule);
    if (days < 1 && !DATE_ONLY.test(candidate.schedule.end_date || '')) {
      return 'Add how many days this should stay on the plan. The document does not say.';
    }
    if (days > MAX_SCHEDULE_DAYS) {
      return `Choose ${MAX_SCHEDULE_DAYS} days or fewer.`;
    }
  }
}

export function candidateIssue(candidate: Candidate): string | undefined {
  if (candidate.physio?.origin === 'reviewer_added' && !candidate.physio.dosage?.trim()) return 'Enter exercise repetitions, holds or session duration.';
  if (candidate.review_status === 'unsupported') {
    return 'This instruction is not supported by enough source evidence.';
  }
  if (!candidate.instruction_text.trim() || !candidate.action_text?.trim()) {
    return 'Both the full instruction and patient-facing task are required.';
  }
  return scheduleIssue(candidate);
}

export function reviewReady(candidates: Candidate[]) {
  return (
    candidates.length > 0 &&
    candidates.every(
      (candidate) =>
        candidate.decision &&
        (candidate.decision === 'rejected' || candidateIssue(candidate) === undefined),
    )
  );
}

/**
 * Sets the day count on one item and carries it forward to later items the reviewer has not set
 * themselves and the document gave no duration for. Returns the ids that were autofilled.
 */
export function applyDayCount(
  candidates: Candidate[],
  index: number,
  days: number,
  reviewerSet: ReadonlySet<string>,
) {
  const autofilled: string[] = [];
  const next = candidates.map((candidate, position) => {
    const own = position === index;
    const follows =
      position > index &&
      days > 0 &&
      candidate.decision !== 'rejected' &&
      candidate.review_status !== 'unsupported' &&
      needsDayCount(candidate) &&
      !candidate.extracted_duration_days &&
      !reviewerSet.has(candidate.candidate_id);
    if (!own && !follows) return candidate;
    if (follows) autofilled.push(candidate.candidate_id);
    return {
      ...candidate,
      schedule: {
        ...candidate.schedule,
        duration_days: days,
        end_date: days > 0 ? undefined : candidate.schedule.end_date,
      },
    };
  });
  return { candidates: next, autofilled };
}

function displayDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function displayTime(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(2000, 0, 1, hour, minute)))
    .toUpperCase();
}

export function scheduleSummary(schedule: Schedule, category?: string) {
  if (category === 'restriction' || schedule.kind === 'persistent') return 'Always visible';
  if (schedule.kind === 'as_needed') return 'As needed · no timed reminder';
  if (!schedule.times.length) return 'Reminder time needed';
  const times = schedule.times.map(displayTime).join(', ');
  if (schedule.kind === 'once') {
    const date = [schedule.date, schedule.start_date].find((value) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value || ''),
    );
    return `Once${date ? ` · ${displayDate(date)}` : ''} · ${times}`;
  }
  const days = scheduleDays(schedule);
  const daysLabel = days > 0 ? ` · ${days} ${days === 1 ? 'day' : 'days'}` : '';
  if (schedule.kind === 'weekly') return `Weekly · ${times}${daysLabel}`;
  return `Daily · ${times}${daysLabel}`;
}
