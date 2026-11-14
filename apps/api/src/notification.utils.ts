export type ExpoResult = {
  status?: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

export function careCirclePushMessage(expoPushToken: string) {
  return {
    to: expoPushToken,
    title: 'Kuvos check-in',
    body: 'Someone in your Care Circle may need a check-in. Open Kuvos for the latest status.',
    sound: 'default',
    channelId: 'care-circle',
    ttl: 24 * 60 * 60,
    data: { kuvosCareCircleAlert: true },
  };
}

export function firstExpoResult(value: unknown): ExpoResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = (value as { data?: ExpoResult | ExpoResult[] }).data;
  return Array.isArray(data) ? data[0] : data;
}

export function nextPushAttempt(now: Date, attempts: number) {
  return new Date(now.getTime() + 2 ** attempts * 60_000);
}
