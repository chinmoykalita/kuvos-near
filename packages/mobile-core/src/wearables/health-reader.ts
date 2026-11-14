import type { SyncReading } from './metrics';

// HealthKit lives in health-reader.ios.ts, so other platforms never bundle it.
export const healthAvailable = () => false;

export function requestHealthAccess(): Promise<void> {
  return Promise.reject(new Error('Apple Health is available only on iPhone.'));
}

export function readHealth(
  _days: number,
  _timezone: string,
): Promise<{ from: string; to: string; readings: SyncReading[] }> {
  return Promise.reject(new Error('Apple Health is available only on iPhone.'));
}
