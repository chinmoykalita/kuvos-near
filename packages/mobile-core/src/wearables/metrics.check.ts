import assert from 'node:assert/strict';
import {
  calorieMessage,
  dayKey,
  formatTile,
  formatValue,
  dailySeries,
  shortDay,
  sleepByDay,
  snapshot,
  sourceKind,
  type Interval,
  type Reading,
} from './metrics.ts';

const tz = 'Asia/Kolkata';
const at = (time: string) => new Date(`${time}+05:30`);
const interval = (start: string, end: string, source = 'Watch'): Interval => ({
  start: at(start),
  end: at(end),
  source,
});

assert.equal(dayKey(at('2026-10-31T00:30:00'), tz), '2026-10-31');

// A night split across midnight lands on the wake-up day.
let sleep = sleepByDay(
  [
    interval('2026-10-30T23:00:00', '2026-10-31T01:00:00'),
    interval('2026-10-31T01:00:00', '2026-10-31T06:30:00'),
  ],
  tz,
);
assert.equal(sleep.get('2026-10-31')?.minutes, 450);
assert.equal(sleep.size, 1);

// Evening segments that end before midnight still belong to the next morning.
sleep = sleepByDay(
  [
    interval('2026-10-30T22:00:00', '2026-10-30T23:30:00'),
    interval('2026-10-30T23:45:00', '2026-10-31T06:00:00'),
  ],
  tz,
);
assert.equal(sleep.get('2026-10-31')?.minutes, 465);

// Overlapping stages from one source are counted once.
sleep = sleepByDay(
  [
    interval('2026-10-31T00:00:00', '2026-10-31T04:00:00'),
    interval('2026-10-31T02:00:00', '2026-10-31T03:00:00'),
    interval('2026-10-31T03:30:00', '2026-10-31T05:00:00'),
  ],
  tz,
);
assert.equal(sleep.get('2026-10-31')?.minutes, 300);

// A Watch and a ring on the same night are never added together.
sleep = sleepByDay(
  [
    interval('2026-10-31T00:00:00', '2026-10-31T06:00:00', 'Watch'),
    interval('2026-10-31T00:10:00', '2026-10-31T06:30:00', 'Oura'),
  ],
  tz,
);
assert.equal(sleep.get('2026-10-31')?.minutes, 380);
assert.equal(sleep.get('2026-10-31')?.source, 'Oura');

assert.equal(sourceKind('Maya’s Apple Watch'), 'watch');
assert.equal(sourceKind('Oura'), 'ring');
assert.equal(sourceKind('Maya’s iPhone'), 'phone');
assert.equal(sourceKind('MyFitnessPal'), 'other');
assert.equal(sourceKind('Springfield'), 'other', 'Ring must be a whole word.');

assert.equal(formatValue('sleep_duration', 385), '6 h 25');
assert.equal(formatValue('steps', 6240), '6,240 steps');
assert.deepEqual(formatTile('sleep_duration', 396), { value: '6.6', unit: 'h' });
assert.deepEqual(formatTile('steps', 6200), { value: '6,200', unit: '' });
assert.deepEqual(formatTile('steps', 12400), { value: '12.4k', unit: '' });
assert.deepEqual(formatTile('hrv_sdnn', null), { value: '–', unit: '' });
assert.equal(formatValue('walking_speed', 1.94), '1.9 km/h');
assert.equal(formatValue('walking_step_length', 43.2), '43 cm');
assert.equal(formatValue('walking_asymmetry', 0), '0.0%');
assert.equal(formatValue('walking_double_support', 28.94), '28.9%');
assert.deepEqual(formatTile('walking_asymmetry', 65.9), { value: '65.9', unit: '%' });
assert.deepEqual(formatTile('resting_heart_rate', 61.6), { value: '62', unit: 'bpm' });

assert.equal(calorieMessage(0, 2000), '2,000 kcal left today');
assert.equal(calorieMessage(2000, 2000), 'Target reached today');
assert.equal(calorieMessage(2150, 2000), '150 kcal past today’s target');
assert.equal(calorieMessage(900, null), 'Set a target to follow today’s total');

const today = '2026-10-31';
const readings: Reading[] = [
  { day: '2026-10-29', metric: 'steps', value: 1000, source: 'phone', unit: 'count' },
  { day: '2026-10-30', metric: 'steps', value: 3000, source: 'phone', unit: 'count' },
  { day: today, metric: 'steps', value: 50, source: 'watch', unit: 'count' },
  { day: '2026-10-29', metric: 'hrv_sdnn', value: 40, source: 'watch', unit: 'ms' },
  { day: '2026-10-02', metric: 'hrv_sdnn', value: 90, source: 'watch', unit: 'ms' },
];

// Today: the running total, or the latest once-a-day value from the past week.
assert.deepEqual(snapshot(readings, 'steps', 'today', today).value, 50);
const hrv = snapshot(readings, 'hrv_sdnn', 'today', today);
assert.equal(hrv.value, 40);
assert.equal(shortDay(hrv.day!, today), 'Thu');
assert.equal(shortDay('2026-10-30', today), 'Yesterday');
assert.equal(snapshot(readings, 'resting_heart_rate', 'today', today).value, null);

// Averages skip missing days and stop running totals at yesterday.
const week = snapshot(readings, 'steps', 'week', today);
assert.equal(week.value, 2000);
assert.equal(week.daysWithData, 2);
assert.equal(week.source, 'phone');
assert.equal(snapshot(readings, 'hrv_sdnn', 'week', today).value, 40);
assert.equal(snapshot(readings, 'hrv_sdnn', 'month', today).value, 65);
assert.equal(
  snapshot([...readings, { ...readings[3], day: '2026-10-01' }], 'hrv_sdnn', 'month', today)
    .daysWithData,
  2,
  'Thirty days include today, so 1 Oct is outside.',
);

const series = dailySeries(readings, 'steps', 7, today);
assert.equal(series.length, 7);
assert.equal(series[0].day, '2026-10-25');
assert.deepEqual(series.at(-1), { day: today, value: 50, partial: true });
assert.equal(series[3].value, null);

console.log('Wearable metric checks passed.');
