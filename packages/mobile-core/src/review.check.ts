import assert from 'node:assert/strict';

import type { Candidate, Extraction } from './api.ts';
import {
  applyDayCount,
  candidateIssue,
  candidatesFrom,
  emptyReminderSlots,
  fieldValue,
  needsIntervalCompletion,
  reviewReady,
  resumeCandidateIndex,
  resumeRoute,
  routineTimes,
  scheduleSummary,
  suggestedReminderSlots,
} from './review.ts';

assert.equal(
  resumeRoute({ id: 'extraction-1', status: 'processing', fileName: 'care.pdf' }).pathname,
  '/extraction/[id]',
);
assert.deepEqual(
  resumeRoute({
    id: 'extraction-2',
    status: 'review_ready',
    fileName: 'care.pdf',
    planId: 'plan-1',
  }),
  {
    pathname: '/review/[id]',
    params: { id: 'extraction-2', planId: 'plan-1' },
  },
);

const candidate: Candidate = {
  candidate_id: 'candidate-1',
  category: 'medication',
  instruction_text: 'Take the prescribed tablet twice daily.',
  action_text: 'Take the prescribed tablet',
  evidence_span_ids: ['span-1'],
  fields: [],
  review_status: 'supported',
  schedule: { kind: 'times_per_day', count: 2, times: ['08:00', '20:00'], duration_days: 7 },
};

assert.equal(resumeCandidateIndex([{ ...candidate, decision: 'accepted' }, candidate]), 1);
assert.equal(resumeCandidateIndex([{ ...candidate, decision: 'accepted' }]), 0);
assert.equal(candidateIssue(candidate), undefined);
assert.equal(reviewReady([{ ...candidate, decision: 'accepted' }]), true);
assert.equal(scheduleSummary(candidate.schedule), 'Daily · 8:00 AM, 8:00 PM · 7 days');
assert.equal(
  scheduleSummary({ kind: 'once', date: '2026-09-24', times: ['10:30'] }),
  'Once · Thu, 24 Sept 2026 · 10:30 AM',
);
assert.equal(scheduleSummary({ kind: 'once', times: ['10:30'] }), 'Once · 10:30 AM');
assert.match(
  candidateIssue({ ...candidate, schedule: { ...candidate.schedule, times: [] } })!,
  /at least one/,
);
assert.equal(
  candidateIssue({ ...candidate, schedule: { ...candidate.schedule, times: ['08:00'] } }),
  undefined,
);
assert.equal(
  candidateIssue({
    ...candidate,
    schedule: { ...candidate.schedule, times: ['08:00', '14:00', '20:00'] },
  }),
  undefined,
);
assert.match(
  candidateIssue({
    ...candidate,
    schedule: { ...candidate.schedule, times: ['08:00', '08:00'] },
  })!,
  /different time/,
);
assert.equal(suggestedReminderSlots({ kind: 'times_per_day', count: 2, times: [] }), 2);
assert.equal(
  needsIntervalCompletion({ kind: 'interval', interval_hours: 6, times: [] }),
  true,
);
assert.equal(
  needsIntervalCompletion({ kind: 'interval', interval_hours: 0, times: [] }),
  false,
);
assert.match(
  candidateIssue({
    ...candidate,
    schedule: { kind: 'interval', interval_hours: 6, times: [], duration_days: 7 },
  })!,
  /backend completion/,
);
assert.equal(emptyReminderSlots({ kind: 'times_per_day', count: 2, times: [] }), 2);
assert.equal(emptyReminderSlots({ kind: 'times_per_day', count: 2, times: ['08:00'] }), 1);
assert.match(
  candidateIssue({ ...candidate, schedule: { ...candidate.schedule, duration_days: 0 } })!,
  /days/,
);
assert.equal(
  candidateIssue({
    ...candidate,
    schedule: { ...candidate.schedule, duration_days: 0, end_date: '2026-09-20' },
  }),
  undefined,
);
assert.equal(reviewReady([{ ...candidate, decision: 'rejected' }]), true);
assert.equal(fieldValue({ name: 'strength', raw_value: '500 mg', unit: 'mg' }), '500 mg');
assert.equal(fieldValue({ name: 'strength', raw_value: '500', unit: 'mg' }), '500 mg');

const second: Candidate = {
  ...candidate,
  candidate_id: 'candidate-2',
  action_text: 'Apply the ointment',
  instruction_text: 'Apply the ointment once daily for 14 days.',
  schedule: { kind: 'times_per_day', count: 1, times: ['21:00'], duration_days: 14 },
};
const extraction = {
  id: 'extraction-1',
  status: 'review_ready',
  result: { evaluation: { candidates: [candidate, second] } },
} as Extraction;
const loaded = candidatesFrom(extraction);
const explanation = { text: 'Original explanation.', sources: [] };
const explanationReview = candidatesFrom({
  ...extraction,
  result: { evaluation: { candidates: [{ ...candidate, explanation }] } },
  review: { candidates: [{ ...candidate, explanation: { ...explanation, text: '', original_text: explanation.text, reviewer_edited: true } }] },
});
assert.equal(explanationReview[0].explanation?.text, '');
assert.equal(explanationReview[0].explanation?.original_text, 'Original explanation.');
assert.equal(explanation.text, 'Original explanation.');
assert.equal(loaded[0].schedule.duration_days, 7);
assert.equal(loaded[1].schedule.duration_days, 14);
assert.equal(loaded[0].extracted_duration_days, 7);
const edited = candidatesFrom({
  ...extraction,
  review: {
    candidates: [
      { ...loaded[0], schedule: { ...loaded[0].schedule, duration_days: 10 } },
      loaded[1],
    ],
  },
});
assert.equal(edited[0].schedule.duration_days, 10);
assert.equal(edited[0].extracted_duration_days, 7);
const morningDose = candidatesFrom({
  id: 'extraction-3',
  status: 'review_ready',
  result: {
    evaluation: {
      candidates: [
        {
          ...candidate,
          candidate_id: 'c001',
          instruction_text: 'Tab Amlodipine 5 mg OD (morning) for BP',
          schedule: {
            kind: 'interval',
            count: 1,
            interval_hours: 0,
            times: [],
            duration_days: 0,
            raw_text: 'OD (morning)',
          },
        },
        {
          ...candidate,
          candidate_id: 'c013',
          category: 'follow_up',
          instruction_text: 'Review after 4 weeks with BP, sugar log and reports.',
          schedule: {
            kind: 'interval',
            count: 0,
            interval_hours: 0,
            times: [],
            duration_days: 28,
          },
        },
      ],
    },
  },
} as Extraction);
assert.equal(morningDose[0].schedule.kind, 'times_per_day');
assert.equal(suggestedReminderSlots(morningDose[0].schedule), 1);
assert.match(candidateIssue(morningDose[0])!, /at least one/);
assert.equal(morningDose[1].schedule.kind, 'once');
assert.equal(candidateIssue({ ...morningDose[1], schedule: { ...morningDose[1].schedule, times: ['09:00'] } }), undefined);
assert.equal(edited[1].schedule.duration_days, 14);

const undated = (id: string, extra: Partial<Candidate> = {}): Candidate => ({
  ...candidate,
  candidate_id: id,
  schedule: { ...candidate.schedule, duration_days: 0 },
  ...extra,
});
const carried = applyDayCount(
  [
    undated('a'),
    undated('b'),
    undated('c', { extracted_duration_days: 14 }),
    undated('d'),
    undated('e', { decision: 'rejected' }),
    undated('f', { schedule: { kind: 'once', times: ['09:00'] } }),
  ],
  0,
  10,
  new Set(['d']),
);
assert.deepEqual(carried.autofilled, ['b']);
assert.equal(carried.candidates[0].schedule.duration_days, 10);
assert.equal(carried.candidates[1].schedule.duration_days, 10);
assert.equal(carried.candidates[2].schedule.duration_days, 0);
assert.equal(carried.candidates[3].schedule.duration_days, 0);
assert.equal(carried.candidates[4].schedule.duration_days, 0);
assert.equal(applyDayCount([undated('a'), undated('b')], 1, 5, new Set()).candidates[0].schedule.duration_days, 0);
assert.equal(
  candidatesFrom({
    id: 'extraction-2',
    status: 'review_ready',
    result: {
      evaluation: {
        candidates: [
          {
            ...candidate,
            schedule: {
              kind: 'times_per_day',
              count: 1,
              times: ['08:00'],
              start_date: '2026-09-05',
              end_date: '2026-09-11',
            },
          },
        ],
      },
    },
  } as Extraction)[0].schedule.duration_days,
  7,
);

const routine = {
  wake: '07:00',
  sleep: '22:00',
  meals: { breakfast: '08:00', lunch: '13:00', dinner: '20:00' },
  exercise: '18:00',
};
const timed = (overrides: Partial<Candidate>): Candidate => ({
  candidate_id: 'routine',
  category: 'medication',
  instruction_text: 'Take one tablet',
  evidence_span_ids: [],
  fields: [],
  schedule: { kind: 'times_per_day', count: 1, times: [] },
  ...overrides,
});
const afterFood = [{ name: 'meal_relation', raw_value: 'after food' }];
assert.deepEqual(routineTimes(timed({}), routine), ['07:00']);
assert.deepEqual(routineTimes(timed({ fields: afterFood }), routine), ['08:00']);
assert.deepEqual(
  routineTimes(timed({ fields: afterFood, schedule: { kind: 'times_per_day', count: 2, times: [] } }), routine),
  ['08:00', '20:00'],
);
assert.deepEqual(
  routineTimes(timed({ fields: [{ name: 'meal_relation', raw_value: 'before breakfast' }] }), routine),
  ['08:00'],
);
assert.deepEqual(
  routineTimes(timed({ fields: [{ name: 'meal_relation', raw_value: 'empty stomach' }] }), routine),
  [],
);
assert.deepEqual(
  routineTimes(
    timed({ fields: [{ name: 'meal_relation', raw_value: 'after lunch' }] }),
    { ...routine, meals: { breakfast: '08:00' } },
  ),
  [],
);
assert.deepEqual(
  routineTimes(timed({ schedule: { kind: 'times_per_day', count: 3, times: [] } }), routine),
  ['07:00', '14:30', '22:00'],
);
assert.deepEqual(routineTimes(timed({ category: 'exercise' }), routine), ['18:00']);
assert.deepEqual(routineTimes(timed({ schedule: { kind: 'times_per_day', count: 1, times: ['09:00'] } }), routine), []);
assert.deepEqual(routineTimes(timed({ schedule: { kind: 'as_needed', times: [] } }), routine), []);
assert.deepEqual(routineTimes(timed({}), undefined), []);
