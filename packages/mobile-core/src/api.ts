import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';

import { authClient } from './auth-client';
import { API_URL, wordmark } from './config';
import type { PatientNotificationSchedule } from './notification-schedule';

export type Box = { x: number; y: number; width: number; height: number };
export type Span = { span_id: string; page: number; text?: string; bounding_box: Box };
export type Schedule = {
  kind: string;
  times: string[];
  count?: number;
  interval_hours?: number;
  needs_user_input?: boolean;
  date?: string;
  start_date?: string;
  end_date?: string;
  duration_days?: number;
  days_of_week?: string[];
};
export type Field = {
  name: string;
  raw_value: string;
  normalized_value?: string;
  unit?: string;
};
export type PhysioSelection = {
  exercise_id: string;
  origin: 'document_match' | 'reviewer_added';
  dosage?: string;
  selected_by?: string;
  library_version?: string;
  instruction_snapshot?: string;
};
export type Candidate = {
  physio?: PhysioSelection | null;
  candidate_id: string;
  category?: string;
  instruction_text: string;
  action_text?: string;
  explanation?: Explanation;
  evidence_span_ids: string[];
  fields: Field[];
  review_status?: string;
  disagreement_notes?: string[];
  decision?: 'accepted' | 'rejected';
  extracted_duration_days?: number;
  schedule: Schedule;
};
export type Explanation = {
  text: string;
  sources: { title: string; url: string; quote: string; evidence_span_ids: string[] }[];
  original_text?: string;
  reviewer_edited?: boolean;
};
export type Extraction = {
  id: string;
  status: string;
  error?: string;
  document?: { id: string; fileName: string };
  planId?: string;
  suggestedPlanName?: string;
  review?: { candidates?: Candidate[] };
  result?: {
    document?: {
      pages?: { page: number }[];
      source_spans?: Span[];
    };
    evaluation?: {
      candidates?: Candidate[];
      general_notes?: string[];
      suggested_plan_name?: string;
    };
    provenance_issues?: string[];
  };
};
export type MarkingWindow = {
  openBeforeMinutes: number;
  closeAfterMinutes: number;
};
export type MarkingWindowState = 'upcoming' | 'open' | 'closed';
export type OccurrenceStatus = 'scheduled' | 'done' | 'skipped' | 'missed';
export type OccurrenceAction = 'done' | 'skipped' | 'undone';
export type SkipReason = 'no_medicines' | 'side_effect' | 'no_one_around';
export type SkipReasonOption = { value: SkipReason; label: string };
export const skipReasonOptions: SkipReasonOption[] = [
  { value: 'no_medicines', label: 'No medicines' },
  { value: 'side_effect', label: 'Side effect' },
  { value: 'no_one_around', label: 'No one around to give it' },
];
export type Today = {
  planId?: string;
  planName?: string;
  patientId?: string;
  date: string;
  timezone: string;
  markingWindow?: MarkingWindow;
  skipReasons?: SkipReasonOption[];
  careCircle?: { notifyIfMissed: string[] };
  restrictions?: Restriction[];
  occurrences?: {
    id: string;
    scheduledAt: string;
    status: OccurrenceStatus;
    actionText: string;
    instructionText: string;
    explanation?: Explanation | null;
    category: string;
    physio?: PhysioSelection | null;
    fields?: Field[];
    schedule?: Schedule;
    extractionId?: string;
    candidateId?: string;
    planId?: string;
    planName?: string;
    reason?: string;
    loggedBy?: string;
    canLog?: boolean;
    window?: {
      opensAt: string;
      closesAt: string;
      state: MarkingWindowState;
    };
  }[];
};
export type PlanSummary = {
  id: string;
  name: string;
  suggestedName?: string;
  status: string;
  timezone?: string;
  createdAt?: string;
  closedAt?: string | null;
  adherence?: {
    done: number;
    skipped: number;
    missed: number;
    remaining: number;
    total: number;
  };
};
export type PlansResponse = {
  patientId: string;
  date: string;
  timezone: string;
  plans: PlanSummary[];
};
export type Restriction = {
  id: string;
  actionText: string;
  instructionText: string;
  explanation?: Explanation | null;
  evidenceSpanIds: string[];
  extractionId: string;
  candidateId: string;
};
export type UploadAsset = { uri: string; name: string; mimeType: string };
export type CareRole = 'PATIENT' | 'CAREGIVER';
export type ResumableExtraction = {
  id: string;
  status: 'queued' | 'processing' | 'review_ready';
  fileName: string;
  planId?: string;
};
export type Meal = 'breakfast' | 'lunch' | 'dinner';
export type DailyRoutine = {
  wake: string;
  sleep: string;
  meals: Partial<Record<Meal, string>>;
  exercise?: string;
};
export type Condition = 'blood_pressure' | 'diabetes' | 'tb' | 'lung_infection';
export type HealthProfile = {
  gender?: 'female' | 'male' | 'other';
  age?: number;
  heightCm?: number;
  weightKg?: number;
  conditions: Condition[];
  otherConditions?: string;
};
export type Membership = {
  id: string;
  role: CareRole;
  missedAlertsEnabled?: boolean;
  canInviteRole?: CareRole;
  patient: {
    id: string;
    name: string;
    timezone: string;
    hasActivePlan?: boolean;
    plans?: { id: string; name: string; status: string }[];
    markingWindow?: MarkingWindow;
    dailyRoutine?: DailyRoutine;
    resumableExtraction?: ResumableExtraction;
  };
};
export type PendingInvitation = {
  id: string;
  role: CareRole;
  expiresAt: string;
  patient: { id: string; name: string };
  invitedBy: { name: string };
};
export type Me = {
  user: {
    id: string;
    name: string;
    phoneNumber?: string;
    aiProcessingConsent: boolean;
  };
  memberships: Membership[];
  pendingInvitations: PendingInvitation[];
};

export { API_URL };

export async function getAuthCookie() {
  return process.env.EXPO_OS === 'web' ? '' : authClient.getCookie();
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    const cookie = await getAuthCookie();
    if (cookie) headers.set('Cookie', cookie);
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers,
      credentials: process.env.EXPO_OS === 'web' ? 'include' : 'omit',
    });
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new Error(
      `Could not reach ${wordmark}.${__DEV__ ? ` Tried ${API_URL}.${detail}` : ''} Check that the API is running on this network.`,
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new Error(message || `Request failed (${response.status}).`);
  }
  return body as T;
}

export function sourcePageUrl(extractionId: string, page: number) {
  return `${API_URL}/extractions/${extractionId}/pages/${page}`;
}

export async function uploadDocument(
  patientId: string,
  asset: UploadAsset,
  planId?: string,
) {
  const file = new File(asset.uri);
  const ticket = await api<{
    documentId: string;
    upload: { url: string; headers: Record<string, string> };
  }>('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patientId,
      ...(planId ? { planId } : {}),
      fileName: asset.name,
      size: file.size,
      md5: file.md5,
    }),
  });
  try {
    const response = await fetch(ticket.upload.url, {
      method: 'PUT',
      headers: ticket.upload.headers,
      // Expo infers a Blob MIME type; bytes preserve the signed Content-Type.
      body: await file.arrayBuffer(),
      credentials: process.env.EXPO_OS === 'web' ? 'include' : 'omit',
    });
    if (!response.ok) throw new Error();
  } catch {
    throw new Error('The document could not be uploaded. Please try again.');
  }
  return api<{
    documentId: string;
    extractionId: string;
    status: string;
    planId?: string;
  }>(`/documents/${ticket.documentId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(planId ? { planId } : {}),
  });
}

export function updateAiProcessingConsent(accepted: boolean) {
  return api<{ accepted: boolean; version: string | null }>(
    '/me/ai-processing-consent',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted }),
    },
  );
}

export function logOccurrence(
  occurrenceId: string,
  action: OccurrenceAction,
  reason?: SkipReason,
) {
  return api(`/occurrences/${occurrenceId}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
  });
}

export function updateMarkingWindow(
  patientId: string,
  markingWindow: MarkingWindow,
) {
  return api<MarkingWindow>(`/patients/${patientId}/marking-window`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(markingWindow),
  });
}

export function getPatientNotificationSchedule(patientId: string) {
  return api<PatientNotificationSchedule>(
    `/patients/${patientId}/notification-schedule`,
  );
}

export function updateCareCircleNotifications(
  patientId: string,
  value: {
    enabled: boolean;
    expoPushToken?: string;
    platform?: 'ios' | 'android';
  },
) {
  return api<{ missedAlertsEnabled: boolean }>(
    `/patients/${patientId}/care-circle-notifications`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    },
  );
}

export function deleteMyAccount() {
  return api<{ status: string }>('/me', { method: 'DELETE' });
}

export function unregisterPushDevice(expoPushToken: string) {
  return api<{ status: string }>('/push-devices/unregister', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expoPushToken }),
  });
}
