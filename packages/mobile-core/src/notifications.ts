import { wordmark } from './config';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import {
  unregisterPushDevice,
  updateCareCircleNotifications,
} from './api';
import {
  patientReminders,
  type PatientNotificationSchedule,
} from './notification-schedule';

const CHANNEL_ID = 'care-reminders';
const CARE_CIRCLE_CHANNEL_ID = 'care-circle';
const MARKER = 'kuvosPatientReminder';
let permissionRequest: Promise<NotificationPermission> | undefined;

export type NotificationPermission =
  | 'granted'
  | 'denied'
  | 'undetermined';
export type PatientNotificationPermission = NotificationPermission;

function granted(status: Notifications.NotificationPermissionsStatus) {
  return (
    status.granted ||
    status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    status.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL
  );
}

function permission(
  status: Notifications.NotificationPermissionsStatus,
): NotificationPermission {
  if (granted(status)) return 'granted';
  return status.canAskAgain ? 'undetermined' : 'denied';
}

function reminderData(request: Notifications.NotificationRequest) {
  const data = request.content.data;
  return data?.[MARKER] === true ? data : undefined;
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Care reminders',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function ensureCareCircleChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CARE_CIRCLE_CHANNEL_ID, {
    name: 'Care Circle check-ins',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function expoPushToken() {
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error(`${wordmark} is not linked to an EAS project.`);
  }
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

export function configureNotificationPresentation() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function patientNotificationPermission(): Promise<PatientNotificationPermission> {
  if (Platform.OS === 'web') return 'denied';
  return permission(await Notifications.getPermissionsAsync());
}

async function requestNotificationPermission(): Promise<PatientNotificationPermission> {
  if (Platform.OS === 'web') return 'denied';
  await ensureChannel();
  const current = await Notifications.getPermissionsAsync();
  if (granted(current) || !current.canAskAgain) return permission(current);
  return permission(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    }),
  );
}

export function requestPatientNotificationPermission(): Promise<PatientNotificationPermission> {
  permissionRequest ??= requestNotificationPermission().finally(() => {
    permissionRequest = undefined;
  });
  return permissionRequest;
}

export async function syncPatientNotifications(
  schedule: PatientNotificationSchedule,
  requestPermission = true,
): Promise<PatientNotificationPermission> {
  if (Platform.OS === 'web') return 'denied';
  const status = requestPermission
    ? await requestPatientNotificationPermission()
    : await patientNotificationPermission();
  if (status !== 'granted') return status;

  await ensureChannel();
  const desired = patientReminders(schedule);
  const desiredKeys = new Set(desired.map((item) => item.key));
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const existingKeys = new Set<string>();

  await Promise.all(
    pending.flatMap((item) => {
      const data = reminderData(item);
      if (!data) return [];
      const key = typeof data.reminderKey === 'string' ? data.reminderKey : '';
      if (!desiredKeys.has(key) || existingKeys.has(key)) {
        return [Notifications.cancelScheduledNotificationAsync(item.identifier)];
      }
      existingKeys.add(key);
      return [];
    }),
  );

  for (const reminder of desired) {
    if (existingKeys.has(reminder.key)) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title:
          reminder.kind === 'due' ? `${wordmark} reminder` : 'A gentle reminder',
        body: reminder.actionText,
        sound: 'default',
        data: {
          [MARKER]: true,
          reminderKey: reminder.key,
          kind: reminder.kind,
          occurrenceId: reminder.occurrenceId,
          patientId: reminder.patientId,
          planId: reminder.planId,
          date: reminder.date,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.firesAt),
        channelId: Platform.OS === 'android' ? CHANNEL_ID : undefined,
      },
    });
  }
  return status;
}

export async function cancelOccurrenceNotifications(occurrenceId: string) {
  if (Platform.OS === 'web') return;
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending.flatMap((item) =>
      reminderData(item)?.occurrenceId === occurrenceId
        ? [Notifications.cancelScheduledNotificationAsync(item.identifier)]
        : [],
    ),
  );
}

export async function clearPatientNotifications() {
  if (Platform.OS === 'web') return;
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    pending.flatMap((item) =>
      reminderData(item)
        ? [Notifications.cancelScheduledNotificationAsync(item.identifier)]
        : [],
    ),
  );
}

export async function setCareCircleNotifications(
  patientId: string,
  enabled: boolean,
): Promise<NotificationPermission> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return 'denied';
  if (!enabled) {
    await updateCareCircleNotifications(patientId, { enabled: false });
    return patientNotificationPermission();
  }
  await ensureCareCircleChannel();
  const status = await requestPatientNotificationPermission();
  if (status !== 'granted') return status;
  await updateCareCircleNotifications(patientId, {
    enabled: true,
    expoPushToken: await expoPushToken(),
    platform: Platform.OS,
  });
  return status;
}

export async function syncCareCirclePushDevice(patientId: string) {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  await ensureCareCircleChannel();
  if ((await patientNotificationPermission()) !== 'granted') return;
  await updateCareCircleNotifications(patientId, {
    enabled: true,
    expoPushToken: await expoPushToken(),
    platform: Platform.OS,
  });
}

export async function unregisterCareCirclePushDevice() {
  if (
    (Platform.OS !== 'ios' && Platform.OS !== 'android') ||
    (await patientNotificationPermission()) !== 'granted'
  ) {
    return;
  }
  await unregisterPushDevice(await expoPushToken());
}
