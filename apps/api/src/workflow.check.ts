import assert from 'node:assert/strict';
import { reviewExplanation } from './explanation';
import {
  datesFrom,
  careCircleDeliveryTime,
  daysThrough,
  fallbackSuggestedPlanName,
  markingBounds,
  markingWindowState,
  parseMarkingWindow,
  parseOccurrenceAction,
  parsePlanName,
  parseScheduleDays,
  scheduleDayCount,
  scheduleNeedsDayCount,
  scheduleStartDate,
  scheduledOccurrences,
  suggestedPlanNameFromResult,
  uniqueClockTimes,
  validSignature,
  zonedDateTime,
} from './workflow.utils';

assert.deepEqual(datesFrom('2026-09-05', 2), ['2026-09-05', '2026-09-06']);
assert.equal(parseScheduleDays(7), 7);
assert.equal(parseScheduleDays(0), 0);
assert.equal(daysThrough('2026-09-05', '2026-09-11'), 7);
assert.equal(scheduleDayCount({ duration_days: 5 }, '2026-09-05'), 5);
assert.equal(scheduleDayCount({ end_date: '2026-09-11' }, '2026-09-05'), 7);
assert.equal(scheduleDayCount({}, '2026-09-05'), 0);
assert.equal(scheduleNeedsDayCount('medication', 'times_per_day'), true);
assert.equal(scheduleNeedsDayCount('restriction', 'persistent'), false);
assert.equal(scheduleNeedsDayCount('follow_up', 'once'), false);
assert.equal(
  scheduleStartDate({ date: '2026-09-20' }, '2026-09-12'),
  '2026-09-20',
);
assert.equal(scheduleStartDate({}, '2026-09-12'), '2026-09-12');
assert.equal(
  zonedDateTime('2026-09-05', '09:00', 'Asia/Kolkata').toISOString(),
  '2026-09-05T03:30:00.000Z',
);
assert(validSignature(Buffer.from('%PDF-example'), '.pdf'));
assert(!validSignature(Buffer.from('not-a-pdf'), '.pdf'));
assert.deepEqual(
  parseOccurrenceAction({ action: 'skipped', reason: 'no_medicines' }),
  {
    action: 'skipped',
    reason: 'no_medicines',
    note: undefined,
  },
);
assert.throws(() => parseOccurrenceAction({ action: 'skipped' }));
assert.throws(() =>
  parseOccurrenceAction({ action: 'done', reason: 'no_medicines' }),
);
assert.deepEqual(parseOccurrenceAction({ action: 'undone' }), {
  action: 'undone',
  reason: undefined,
  note: undefined,
});
assert.throws(() =>
  parseOccurrenceAction({ action: 'undone', reason: 'no_medicines' }),
);
assert.throws(() =>
  parseOccurrenceAction({ action: 'skipped', reason: 'pain' }),
);

const scheduled = new Date('2026-09-12T10:00:00.000Z');
const bounds = markingBounds(scheduled, 90, 180);
assert.equal(bounds.opensAt.toISOString(), '2026-09-12T08:30:00.000Z');
assert.equal(bounds.closesAt.toISOString(), '2026-09-12T13:00:00.000Z');
assert.equal(
  markingWindowState(
    new Date('2026-09-12T08:29:59.000Z'),
    bounds.opensAt,
    bounds.closesAt,
  ),
  'upcoming',
);
assert.equal(
  markingWindowState(
    new Date('2026-09-12T10:00:00.000Z'),
    bounds.opensAt,
    bounds.closesAt,
  ),
  'open',
);
assert.equal(
  markingWindowState(
    new Date('2026-09-12T13:00:01.000Z'),
    bounds.opensAt,
    bounds.closesAt,
  ),
  'closed',
);
assert.equal(
  careCircleDeliveryTime(
    new Date('2026-09-17T17:30:00.000Z'),
    'Asia/Kolkata',
  ).toISOString(),
  '2026-09-18T01:30:00.000Z',
);
assert.equal(
  careCircleDeliveryTime(
    new Date('2026-09-17T00:30:00.000Z'),
    'Asia/Kolkata',
  ).toISOString(),
  '2026-09-17T01:30:00.000Z',
);
assert.equal(
  careCircleDeliveryTime(
    new Date('2026-09-17T06:30:00.000Z'),
    'Asia/Kolkata',
  ).toISOString(),
  '2026-09-17T06:30:00.000Z',
);
assert.deepEqual(
  parseMarkingWindow({ openBeforeMinutes: 90, closeAfterMinutes: 180 }),
  { openBeforeMinutes: 90, closeAfterMinutes: 180 },
);
assert.throws(() =>
  parseMarkingWindow({ openBeforeMinutes: 90, closeAfterMinutes: 0 }),
);
assert.equal(parsePlanName('  Cardiac  '), 'Cardiac');
assert.throws(() => parsePlanName('A'));
assert.equal(fallbackSuggestedPlanName(['exercise', 'exercise']), 'Physio');
assert.equal(fallbackSuggestedPlanName(['medication']), 'Medication');
assert.equal(fallbackSuggestedPlanName([]), 'Care plan');
assert.equal(
  suggestedPlanNameFromResult({
    evaluation: { suggested_plan_name: 'Dental', candidates: [] },
  }),
  'Dental',
);
assert.equal(
  suggestedPlanNameFromResult({
    evaluation: {
      candidates: [{ category: 'exercise' }, { category: 'exercise' }],
    },
  }),
  'Physio',
);

const originalExplanation = {
  text: 'This exercise supports movement.',
  sources: [
    {
      title: 'Document',
      url: '',
      quote: 'Supports movement',
      evidence_span_ids: ['span-1'],
    },
  ],
};
const editedExplanation = reviewExplanation(
  {
    text: '  Helps movement.  ',
    sources: [{ url: 'https://attacker.test' }],
    original_text: 'forged',
  },
  originalExplanation,
);
assert.equal(editedExplanation.text, 'Helps movement.');
assert.equal(editedExplanation.original_text, originalExplanation.text);
assert.equal(editedExplanation.reviewer_edited, true);
assert.deepEqual(editedExplanation.sources, originalExplanation.sources);
assert.equal(
  reviewExplanation(undefined, originalExplanation).reviewer_edited,
  false,
);
assert.equal(reviewExplanation({ text: '' }, originalExplanation).text, '');
assert.equal(reviewExplanation(undefined, undefined).text, '');
assert.throws(() => reviewExplanation({ text: 12 }, originalExplanation));
assert.throws(() =>
  reviewExplanation({ text: 'x'.repeat(1201) }, originalExplanation),
);

assert.deepEqual(uniqueClockTimes(['08:00', '20:00', '08:00']), [
  '08:00',
  '20:00',
]);
const duplicated = scheduledOccurrences(
  {
    category: 'medication',
    schedule: {
      kind: 'times_per_day',
      times: ['08:00', '08:00', '20:00'],
      duration_days: 2,
    },
  },
  '2026-09-19',
  'Asia/Kolkata',
);
assert.equal(duplicated.length, 4);
assert.equal(new Set(duplicated.map((date) => date.getTime())).size, 4);
assert.deepEqual(
  duplicated.map((date) => date.toISOString()),
  [
    '2026-09-19T02:30:00.000Z',
    '2026-09-19T14:30:00.000Z',
    '2026-09-20T02:30:00.000Z',
    '2026-09-20T14:30:00.000Z',
  ],
);
assert.deepEqual(
  scheduledOccurrences(
    {
      category: 'restriction',
      schedule: { kind: 'persistent', times: ['08:00'] },
    },
    '2026-09-19',
    'Asia/Kolkata',
  ),
  [],
);
assert.equal(
  scheduledOccurrences(
    {
      category: 'follow_up',
      schedule: {
        kind: 'once',
        times: ['10:30', '10:30'],
        date: '2026-09-24',
        duration_days: 7,
      },
    },
    '2026-09-19',
    'Asia/Kolkata',
  ).length,
  1,
);

console.log('workflow check passed');
