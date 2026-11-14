import assert from 'node:assert/strict';

import {
  patientReminders,
  type PatientNotificationSchedule,
} from './notification-schedule.ts';

const schedule: PatientNotificationSchedule = {
  patientId: 'patient-1',
  timezone: 'Asia/Kolkata',
  syncedAt: '2026-09-17T08:00:00.000Z',
  occurrences: [
    {
      id: 'occurrence-1',
      planId: 'plan-1',
      date: '2026-09-17',
      actionText: 'Take the prescribed tablet',
      scheduledAt: '2026-09-17T10:00:00.000Z',
      closesAt: '2026-09-17T13:00:00.000Z',
    },
  ],
};

const reminders = patientReminders(schedule, Date.parse(schedule.syncedAt));
assert.deepEqual(
  reminders.map(({ kind, firesAt }) => [kind, new Date(firesAt).toISOString()]),
  [
    ['due', '2026-09-17T10:00:00.000Z'],
    ['follow_up', '2026-09-17T10:30:00.000Z'],
  ],
);

const shortWindow = patientReminders(
  {
    ...schedule,
    occurrences: [
      {
        ...schedule.occurrences[0],
        closesAt: '2026-09-17T10:20:00.000Z',
      },
    ],
  },
  Date.parse(schedule.syncedAt),
);
assert.equal(
  new Date(shortWindow[1].firesAt).toISOString(),
  '2026-09-17T10:15:00.000Z',
);
assert.equal(
  patientReminders(schedule, Date.parse('2026-09-17T13:00:00.000Z')).length,
  0,
);
assert.equal(
  patientReminders(
    {
      ...schedule,
      occurrences: Array.from({ length: 40 }, (_, index) => ({
        ...schedule.occurrences[0],
        id: `occurrence-${index}`,
        scheduledAt: new Date(
          Date.parse('2026-09-17T10:00:00.000Z') + index * 60 * 60_000,
        ).toISOString(),
        closesAt: new Date(
          Date.parse('2026-09-17T13:00:00.000Z') + index * 60 * 60_000,
        ).toISOString(),
      })),
    },
    Date.parse(schedule.syncedAt),
  ).length,
  60,
);

console.log('notification schedule check passed');
