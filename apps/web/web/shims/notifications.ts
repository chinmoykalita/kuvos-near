// ponytail: the web app has no reminders yet. Replace with Web Push (service worker plus an
// API subscription endpoint) when browser reminders are needed.
export type NotificationPermissionsStatus = {
  granted: boolean;
  canAskAgain: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  ios?: { status: number };
};
export type NotificationRequest = { identifier: string; content: { data?: Record<string, unknown> } };
export type NotificationResponse = { notification: { request: NotificationRequest } };

const denied: NotificationPermissionsStatus = { granted: false, canAskAgain: false, status: 'denied' };

export enum IosAuthorizationStatus { NOT_DETERMINED, DENIED, AUTHORIZED, PROVISIONAL, EPHEMERAL }
export enum AndroidImportance { UNKNOWN, UNSPECIFIED, NONE, MIN, LOW, DEFAULT, HIGH, MAX }
export enum SchedulableTriggerInputTypes {
  CALENDAR = 'calendar', DAILY = 'daily', WEEKLY = 'weekly', MONTHLY = 'monthly',
  YEARLY = 'yearly', DATE = 'date', TIME_INTERVAL = 'timeInterval',
}

export async function getPermissionsAsync() { return denied; }
export async function requestPermissionsAsync() { return denied; }
export async function getAllScheduledNotificationsAsync(): Promise<NotificationRequest[]> { return []; }
export async function scheduleNotificationAsync(): Promise<string> { return ''; }
export async function cancelScheduledNotificationAsync() {}
export async function cancelAllScheduledNotificationsAsync() {}
export async function setNotificationChannelAsync() { return null; }
export async function getExpoPushTokenAsync(): Promise<{ data: string }> {
  throw new Error('Push notifications are not available on the web.');
}
export function setNotificationHandler() {}
export function getLastNotificationResponse(): NotificationResponse | null { return null; }
export function clearLastNotificationResponse() {}
export function addNotificationResponseReceivedListener() { return { remove() {} }; }
