export type WearableMetric =
  | 'resting_heart_rate'
  | 'hrv_sdnn'
  | 'sleep_duration'
  | 'steps'
  | 'calories_consumed'
  | 'walking_speed'
  | 'walking_step_length'
  | 'walking_asymmetry'
  | 'walking_double_support';
export type WearableSource = 'watch' | 'ring' | 'phone' | 'other';
export type HealthGroup = 'vitals' | 'sleep' | 'mobility' | 'food';
export type HealthPeriod = 'today' | 'week' | 'month';

export type SyncReading = {
  day: string;
  metric: WearableMetric;
  value: number;
  source: WearableSource;
};
export type Reading = SyncReading & { unit: string };
export type Interval = { start: Date; end: Date; source: string };

export const metricDetails: Record<WearableMetric, { label: string }> = {
  resting_heart_rate: { label: 'Resting heart rate' },
  hrv_sdnn: { label: 'HRV' },
  sleep_duration: { label: 'Sleep' },
  steps: { label: 'Steps' },
  calories_consumed: { label: 'Calories eaten' },
  walking_speed: { label: 'Walking speed' },
  walking_step_length: { label: 'Step length' },
  walking_asymmetry: { label: 'Walking asymmetry' },
  walking_double_support: { label: 'Double support time' },
};

export const healthGroups: {
  group: HealthGroup;
  label: string;
  metrics: WearableMetric[];
}[] = [
  { group: 'vitals', label: 'Vitals', metrics: ['resting_heart_rate', 'hrv_sdnn'] },
  { group: 'sleep', label: 'Sleep', metrics: ['sleep_duration'] },
  {
    group: 'mobility',
    label: 'Mobility',
    metrics: [
      'steps',
      'walking_speed',
      'walking_step_length',
      'walking_asymmetry',
      'walking_double_support',
    ],
  },
  { group: 'food', label: 'Food', metrics: ['calories_consumed'] },
];

export const periodDays: Record<HealthPeriod, number> = {
  today: 1,
  week: 7,
  month: 30,
};

// Running totals: today's number is still growing, so averages stop at yesterday.
const cumulative = new Set<WearableMetric>(['steps', 'calories_consumed']);

// ponytail: metric units only; follow Apple Health's preferred units when US users join.
const units: Partial<Record<WearableMetric, string>> = {
  resting_heart_rate: 'bpm',
  hrv_sdnn: 'ms',
  steps: 'steps',
  calories_consumed: 'kcal',
  walking_speed: 'km/h',
  walking_step_length: 'cm',
  walking_asymmetry: '%',
  walking_double_support: '%',
};
// Walking measurements are small numbers where the decimal carries meaning.
const oneDecimal = new Set<WearableMetric>([
  'walking_speed',
  'walking_asymmetry',
  'walking_double_support',
]);
const number = (metric: WearableMetric, value: number) =>
  oneDecimal.has(metric)
    ? value.toFixed(1)
    : Math.round(value).toLocaleString('en-US');

export const sourceLabels: Record<WearableSource, string> = {
  watch: 'Watch',
  ring: 'Ring',
  phone: 'Phone',
  other: 'Health app',
};

// The device name often contains the owner's name, so only its kind leaves the phone.
export function sourceKind(name: string): WearableSource {
  if (/watch/i.test(name)) return 'watch';
  if (/\b(ring|oura|ultrahuman|ringconn)\b/i.test(name)) return 'ring';
  if (/\b(iphone|ipad|phone)\b/i.test(name)) return 'phone';
  return 'other';
}

export function dayKey(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const HOUR = 3_600_000;
const SLEEP_DAY_SHIFT = 6 * HOUR;

// Sleep belongs to the morning you wake: anything ending after 6 PM counts towards tomorrow.
export function sleepByDay(intervals: Interval[], timezone: string) {
  const bySource = new Map<string, Interval[]>();
  for (const interval of intervals) {
    const list = bySource.get(interval.source) ?? [];
    list.push(interval);
    bySource.set(interval.source, list);
  }
  const best = new Map<string, { minutes: number; source: string }>();
  for (const [source, list] of bySource) {
    const totals = new Map<string, number>();
    let cursor = -Infinity;
    // Overlapping stages count once; separate sources are never added together.
    for (const { start, end } of [...list].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    )) {
      const from = Math.max(start.getTime(), cursor);
      const to = end.getTime();
      if (to <= from) continue;
      cursor = to;
      const day = dayKey(new Date(to + SLEEP_DAY_SHIFT), timezone);
      totals.set(day, (totals.get(day) ?? 0) + (to - from) / 60_000);
    }
    for (const [day, minutes] of totals) {
      const current = best.get(day);
      if (!current || minutes > current.minutes) {
        best.set(day, { minutes, source });
      }
    }
  }
  return best;
}

export function formatValue(metric: WearableMetric, value: number) {
  if (metric === 'sleep_duration') {
    const minutes = Math.round(value);
    return `${Math.floor(minutes / 60)} h ${minutes % 60}`;
  }
  const unit = units[metric];
  const shown = number(metric, value);
  if (!unit) return shown;
  return unit === '%' ? `${shown}%` : `${shown} ${unit}`;
}

// Short forms for the week tiles: value and unit are styled separately.
export function formatTile(metric: WearableMetric, value: number | null) {
  if (value === null) return { value: '–', unit: '' };
  if (metric === 'sleep_duration') {
    return { value: (value / 60).toFixed(1), unit: 'h' };
  }
  if (metric === 'steps') {
    return value >= 10000
      ? { value: `${(value / 1000).toFixed(1)}k`, unit: '' }
      : { value: Math.round(value).toLocaleString('en-US'), unit: '' };
  }
  return { value: number(metric, value), unit: units[metric] ?? '' };
}

export function formatDay(day: string, today: string) {
  if (day === today) return 'Today';
  if (day === previousDay(today)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

export const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 24 * HOUR)
    .toISOString()
    .slice(0, 10);

export const previousDay = (day: string) => addDays(day, -1);

// Tile captions sit within the last week, where a weekday is unambiguous.
export function shortDay(day: string, today: string) {
  if (day === today) return 'Today';
  if (day === previousDay(today)) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${day}T12:00:00Z`));
}

export type Snapshot = {
  value: number | null;
  // The reading's day for Today; null for averages.
  day: string | null;
  daysWithData: number;
  daysInPeriod: number;
  source: WearableSource | null;
};

function periodWindow(metric: WearableMetric, days: number, today: string) {
  const to = cumulative.has(metric) ? previousDay(today) : today;
  return { from: addDays(to, 1 - days), to };
}

function commonest(sources: WearableSource[]) {
  const counts = new Map<WearableSource, number>();
  for (const source of sources) counts.set(source, (counts.get(source) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Today shows today's running total, or the latest reading from the past week
// for once-a-day values. Longer periods average the days that have data.
export function snapshot(
  readings: Reading[],
  metric: WearableMetric,
  period: HealthPeriod,
  today: string,
): Snapshot {
  const rows = readings.filter((reading) => reading.metric === metric);
  if (period === 'today') {
    const latest = cumulative.has(metric)
      ? rows.find(({ day }) => day === today)
      : rows
          .filter(({ day }) => day <= today && day >= addDays(today, -6))
          .sort((a, b) => b.day.localeCompare(a.day))[0];
    return {
      value: latest?.value ?? null,
      day: latest?.day ?? null,
      daysWithData: latest ? 1 : 0,
      daysInPeriod: 1,
      source: latest?.source ?? null,
    };
  }
  const days = periodDays[period];
  const { from, to } = periodWindow(metric, days, today);
  const inWindow = rows.filter(({ day }) => day >= from && day <= to);
  return {
    value: inWindow.length
      ? inWindow.reduce((sum, { value }) => sum + value, 0) / inWindow.length
      : null,
    day: null,
    daysWithData: inWindow.length,
    daysInPeriod: days,
    source: commonest(inWindow.map(({ source }) => source)),
  };
}

export type DailyPoint = { day: string; value: number | null; partial: boolean };

// One point per calendar day, oldest first; today's running total is marked partial.
export function dailySeries(
  readings: Reading[],
  metric: WearableMetric,
  days: number,
  today: string,
): DailyPoint[] {
  const values = new Map(
    readings
      .filter((reading) => reading.metric === metric)
      .map((reading) => [reading.day, reading.value]),
  );
  return Array.from({ length: days }, (_, index) => {
    const day = addDays(today, index + 1 - days);
    return {
      day,
      value: values.get(day) ?? null,
      partial: day === today && cumulative.has(metric),
    };
  });
}

export const hasReadings = (readings: Reading[], metric: WearableMetric) =>
  readings.some((reading) => reading.metric === metric);

export const periodCaption = (snap: Snapshot, today: string) =>
  snap.day
    ? shortDay(snap.day, today)
    : snap.daysInPeriod > 1
      ? `${snap.daysWithData} of ${snap.daysInPeriod} days`
      : 'No reading';

// Neutral wording only: eating past a target is never framed as a failure.
export function calorieMessage(eaten: number, target: number | null) {
  if (!target) return 'Set a target to follow today’s total';
  const left = Math.round(target - eaten);
  if (left > 0) return `${left.toLocaleString('en-US')} kcal left today`;
  return left === 0
    ? 'Target reached today'
    : `${Math.abs(left).toLocaleString('en-US')} kcal past today’s target`;
}
