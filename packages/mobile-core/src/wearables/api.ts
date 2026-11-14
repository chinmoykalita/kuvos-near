import { Platform } from 'react-native';

import { api, type CareRole } from '../api';
import type { Reading, SyncReading, WearableMetric } from './metrics';

export const APPLE_HEALTH = 'apple-health';

export type WearableSummary = {
  timezone: string;
  today: string;
  consentVersion: string;
  connections: {
    provider: string;
    lastSyncedAt: string | null;
    consentCurrent: boolean;
  }[];
  week: Record<WearableMetric, number | null>;
  calorieTarget: number | null;
  readings: Reading[];
};

// Android waits for Health Connect. Caregivers never see health data, and their
// phones hold their own readings rather than the patient's.
export const healthTabEnabled = (role: CareRole) =>
  Platform.OS === 'ios' && role === 'PATIENT';

const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });

const base = (patientId: string) => `/patients/${patientId}/wearables`;

export const getWearables = (patientId: string) =>
  api<WearableSummary>(base(patientId));

export const connectAppleHealth = (patientId: string, consentVersion: string) =>
  send<WearableSummary>(`${base(patientId)}/${APPLE_HEALTH}`, 'PUT', {
    accepted: true,
    consentVersion,
  });

export const syncAppleHealth = (
  patientId: string,
  batch: { from: string; to: string; readings: SyncReading[] },
) =>
  send<WearableSummary>(`${base(patientId)}/${APPLE_HEALTH}/sync`, 'POST', batch);

export const setCalorieTarget = (patientId: string, target: number | null) =>
  send<WearableSummary>(`${base(patientId)}/goals/calories_consumed`, 'PUT', {
    target,
  });

export const disconnectAppleHealth = (patientId: string) =>
  send<WearableSummary>(`${base(patientId)}/${APPLE_HEALTH}`, 'DELETE');
