import { BadRequestException } from '@nestjs/common';

export const skipReasons = [
  'no_medicines',
  'side_effect',
  'no_one_around',
] as const;

export const skipReasonOptions: {
  value: (typeof skipReasons)[number];
  label: string;
}[] = [
  { value: 'no_medicines', label: 'No medicines' },
  { value: 'side_effect', label: 'Side effect' },
  { value: 'no_one_around', label: 'No one around to give it' },
];

export const DEFAULT_MARK_OPEN_BEFORE_MINUTES = 90;
export const DEFAULT_MARK_CLOSE_AFTER_MINUTES = 180;

export type MarkingWindowState = 'upcoming' | 'open' | 'closed';

export type OccurrenceAction = {
  action: 'done' | 'skipped' | 'undone';
  reason?: (typeof skipReasons)[number];
  note?: string;
};

export function parseMarkingWindow(value: unknown): {
  openBeforeMinutes: number;
  closeAfterMinutes: number;
} {
  const body =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const openBeforeMinutes = minutes(
    body.openBeforeMinutes,
    'openBeforeMinutes',
    0,
    24 * 60,
  );
  const closeAfterMinutes = minutes(
    body.closeAfterMinutes,
    'closeAfterMinutes',
    15,
    24 * 60,
  );
  return { openBeforeMinutes, closeAfterMinutes };
}

function minutes(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new BadRequestException(
      `${label} must be a whole number of minutes between ${min} and ${max}.`,
    );
  }
  return value;
}

export function markingBounds(
  scheduledAt: Date,
  openBeforeMinutes: number,
  closeAfterMinutes: number,
) {
  return {
    opensAt: new Date(scheduledAt.getTime() - openBeforeMinutes * 60_000),
    closesAt: new Date(scheduledAt.getTime() + closeAfterMinutes * 60_000),
  };
}

export function markingWindowState(
  now: Date,
  opensAt: Date,
  closesAt: Date,
): MarkingWindowState {
  if (now.getTime() < opensAt.getTime()) return 'upcoming';
  if (now.getTime() > closesAt.getTime()) return 'closed';
  return 'open';
}

export function parseOccurrenceAction(value: unknown): OccurrenceAction {
  const body =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const action = body.action;
  if (action !== 'done' && action !== 'skipped' && action !== 'undone') {
    throw new BadRequestException('Action must be done, skipped, or undone.');
  }
  const reason = body.reason;
  if (
    action === 'skipped' &&
    (typeof reason !== 'string' ||
      !skipReasons.includes(reason as (typeof skipReasons)[number]))
  ) {
    throw new BadRequestException('A valid skip reason is required.');
  }
  if (action !== 'skipped' && reason !== undefined) {
    throw new BadRequestException(
      'Done and undone actions cannot include a skip reason.',
    );
  }
  const note = body.note;
  if (
    note !== undefined &&
    (typeof note !== 'string' || note.trim().length > 500)
  ) {
    throw new BadRequestException('Note must be 500 characters or fewer.');
  }
  return {
    action,
    reason:
      action === 'skipped' ? (reason as OccurrenceAction['reason']) : undefined,
    note: typeof note === 'string' && note.trim() ? note.trim() : undefined,
  };
}

export function validSignature(buffer: Buffer, extension: string): boolean {
  if (extension === '.pdf') return buffer.subarray(0, 5).toString() === '%PDF-';
  if (extension === '.png')
    return buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (extension === '.jpg' || extension === '.jpeg')
    return buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  return (
    buffer.subarray(0, 4).equals(Buffer.from('49492a00', 'hex')) ||
    buffer.subarray(0, 4).equals(Buffer.from('4d4d002a', 'hex'))
  );
}

export function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function zonedDateTime(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(intended));
  const value = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  const displayed = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
  );
  return new Date(intended + (intended - displayed));
}

export function careCircleDeliveryTime(now: Date, timeZone: string): Date {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
  if (hour >= 21) {
    return zonedDateTime(
      datesFrom(dateInZone(now, timeZone), 2)[1],
      '07:00',
      timeZone,
    );
  }
  if (hour < 7) {
    return zonedDateTime(dateInZone(now, timeZone), '07:00', timeZone);
  }
  return now;
}

export function datesFrom(start: string, count: number): string[] {
  const date = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SCHEDULE_DAYS = 366;

export function parseScheduleDays(value: unknown): number {
  const days = Number(value);
  return Number.isInteger(days) && days >= 0 ? days : 0;
}

export function scheduleNeedsDayCount(category: string, kind: string): boolean {
  return (
    category !== 'restriction' &&
    !['persistent', 'as_needed', 'once'].includes(kind)
  );
}

export function daysThrough(start: string, end: string): number {
  if (!DATE_ONLY.test(start) || !DATE_ONLY.test(end)) return 0;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return 0;
  }
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

export function scheduleStartDate(
  schedule: { date?: unknown; start_date?: unknown },
  today: string,
): string {
  const explicit = typeof schedule.date === 'string' ? schedule.date : '';
  const start =
    typeof schedule.start_date === 'string' ? schedule.start_date : '';
  if (DATE_ONLY.test(explicit)) return explicit;
  if (DATE_ONLY.test(start) && start > today) return start;
  return today;
}

export function scheduleDayCount(
  schedule: { duration_days?: unknown; end_date?: unknown },
  start: string,
): number {
  const requested = parseScheduleDays(schedule.duration_days);
  if (requested > 0) return requested;
  return typeof schedule.end_date === 'string'
    ? daysThrough(start, schedule.end_date)
    : 0;
}

const clockTime = /^([01]\d|2[0-3]):[0-5]\d$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

// Extractions saved before the worker enforced HH:MM times and YYYY-MM-DD dates can hold words
// ("morning", "after 4 weeks"). Clients format these as clock times and dates, so only explicit
// values are served; the wording stays in raw_text and the instruction for the reviewer.
export function reviewableResult(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return result;
  const root = result as Record<string, unknown>;
  const evaluation = root.evaluation as Record<string, unknown> | undefined;
  if (!evaluation || !Array.isArray(evaluation.candidates)) return result;
  const candidates = (evaluation.candidates as unknown[]).map((value) => {
    if (!value || typeof value !== 'object') return value;
    const candidate = value as Record<string, unknown>;
    const schedule = candidate.schedule as Record<string, unknown> | undefined;
    if (!schedule || typeof schedule !== 'object') return candidate;
    const date = (key: string) =>
      typeof schedule[key] === 'string' && !isoDate.test(schedule[key])
        ? { [key]: '' }
        : {};
    return {
      ...candidate,
      schedule: {
        ...schedule,
        ...(Array.isArray(schedule.times)
          ? {
              times: schedule.times.filter(
                (time): time is string =>
                  typeof time === 'string' && clockTime.test(time),
              ),
            }
          : {}),
        ...date('date'),
        ...date('start_date'),
        ...date('end_date'),
      },
    };
  });
  return { ...root, evaluation: { ...evaluation, candidates } };
}

export function uniqueClockTimes(times: string[]): string[] {
  return [...new Set(times)];
}

export function scheduledOccurrences(
  candidate: {
    category: string;
    schedule: {
      kind: string;
      times: string[];
      duration_days?: unknown;
      end_date?: unknown;
      date?: unknown;
      start_date?: unknown;
      days_of_week?: unknown;
    };
  },
  today: string,
  timezone: string,
): Date[] {
  if (
    candidate.category === 'restriction' ||
    ['persistent', 'as_needed'].includes(candidate.schedule.kind)
  ) {
    return [];
  }
  const start = scheduleStartDate(candidate.schedule, today);
  const dayCount =
    candidate.schedule.kind === 'once'
      ? 1
      : scheduleDayCount(candidate.schedule, start);
  if (dayCount < 1) return [];
  let dates = datesFrom(start, Math.min(dayCount, MAX_SCHEDULE_DAYS));
  if (
    candidate.schedule.kind === 'weekly' &&
    Array.isArray(candidate.schedule.days_of_week)
  ) {
    const weekdays = new Set(
      candidate.schedule.days_of_week.map((day) =>
        String(day).slice(0, 3).toLowerCase(),
      ),
    );
    dates = dates.filter((date) =>
      weekdays.has(
        new Intl.DateTimeFormat('en-US', {
          weekday: 'short',
          timeZone: 'UTC',
        })
          .format(new Date(`${date}T12:00:00Z`))
          .toLowerCase(),
      ),
    );
  }
  const times = uniqueClockTimes(candidate.schedule.times);
  const seen = new Set<number>();
  return dates.flatMap((date) =>
    times.flatMap((time) => {
      const scheduledAt = zonedDateTime(date, time, timezone);
      const key = scheduledAt.getTime();
      if (seen.has(key)) return [];
      seen.add(key);
      return [scheduledAt];
    }),
  );
}

export const PLAN_NAME_MIN = 2;
export const PLAN_NAME_MAX = 40;

export function parsePlanName(value: unknown, label = 'Plan name'): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${label} is required.`);
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < PLAN_NAME_MIN || name.length > PLAN_NAME_MAX) {
    throw new BadRequestException(
      `${label} must be ${PLAN_NAME_MIN}-${PLAN_NAME_MAX} characters.`,
    );
  }
  return name;
}

const categoryPlanNames: Record<string, string> = {
  exercise: 'Physio',
  medication: 'Medication',
  restriction: 'Restrictions',
  care_task: 'Care tasks',
  follow_up: 'Follow-up',
  monitoring: 'Monitoring',
};

export function fallbackSuggestedPlanName(categories: string[]): string {
  const counts = new Map<string, number>();
  for (const category of categories) {
    const label = categoryPlanNames[category];
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [label, count] of counts) {
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  return best || 'Care plan';
}

export function suggestedPlanNameFromResult(result: unknown): string {
  const root =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const evaluation =
    root.evaluation !== null &&
    typeof root.evaluation === 'object' &&
    !Array.isArray(root.evaluation)
      ? (root.evaluation as Record<string, unknown>)
      : {};
  const suggested = evaluation.suggested_plan_name;
  if (typeof suggested === 'string') {
    const trimmed = suggested.trim().replace(/\s+/g, ' ');
    if (trimmed.length >= PLAN_NAME_MIN && trimmed.length <= PLAN_NAME_MAX) {
      return trimmed;
    }
  }
  const candidates = Array.isArray(evaluation.candidates)
    ? evaluation.candidates
    : [];
  const categories = candidates
    .map((candidate) => {
      if (
        candidate === null ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        return '';
      }
      const category = (candidate as Record<string, unknown>).category;
      return typeof category === 'string' ? category : '';
    })
    .filter(Boolean);
  return fallbackSuggestedPlanName(categories);
}
