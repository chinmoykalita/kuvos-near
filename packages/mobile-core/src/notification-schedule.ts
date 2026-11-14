export type PatientNotificationSchedule = {
  patientId: string;
  timezone: string;
  syncedAt: string;
  occurrences: {
    id: string;
    planId: string;
    date: string;
    actionText: string;
    scheduledAt: string;
    closesAt: string;
  }[];
};

export type PatientReminder = {
  key: string;
  kind: 'due' | 'follow_up';
  occurrenceId: string;
  planId: string;
  patientId: string;
  date: string;
  actionText: string;
  firesAt: number;
};

const FOLLOW_UP_MS = 30 * 60_000;
const BEFORE_CLOSE_MS = 5 * 60_000;
const MAX_PENDING_REMINDERS = 60;

export function patientReminders(
  schedule: PatientNotificationSchedule,
  now = Date.now(),
): PatientReminder[] {
  return schedule.occurrences
    .flatMap((occurrence): PatientReminder[] => {
      const due = Date.parse(occurrence.scheduledAt);
      const closes = Date.parse(occurrence.closesAt);
      if (!Number.isFinite(due) || !Number.isFinite(closes)) return [];
      const base = {
        occurrenceId: occurrence.id,
        planId: occurrence.planId,
        patientId: schedule.patientId,
        date: occurrence.date,
        actionText: occurrence.actionText,
      };
      const reminders: PatientReminder[] = [];
      if (due > now) {
        reminders.push({
          ...base,
          key: `${occurrence.id}:due:${due}`,
          kind: 'due',
          firesAt: due,
        });
      }
      const followUp = Math.min(due + FOLLOW_UP_MS, closes - BEFORE_CLOSE_MS);
      if (followUp > now && followUp > due) {
        reminders.push({
          ...base,
          key: `${occurrence.id}:follow_up:${followUp}`,
          kind: 'follow_up',
          firesAt: followUp,
        });
      }
      return reminders;
    })
    .sort((left, right) => left.firesAt - right.firesAt)
    .slice(0, MAX_PENDING_REMINDERS);
}
