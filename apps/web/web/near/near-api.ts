import { api } from '@kuvos/mobile-core/api';

export type Check = { name: string; ok: boolean | null; detail: string };
export type Attestation = {
  purpose: string;
  model: string;
  signatureKind: string;
  signingAddress: string;
  signedText: string;
  signature: string;
  tcbStatus: string | null;
  composeHash: string | null;
  e2ee: boolean;
};
export type ProofBundle = {
  version: string;
  event: {
    id: string;
    kind: 'plan_version' | 'activity' | 'gate_decision';
    subjectId: string;
    digest: string;
    payload: string;
    state: 'recorded' | 'signed' | 'anchored';
    createdAt: string;
    actorId: string | null;
  };
  signing: { message: string; nonce: string; recipient: string };
  signature: { accountId: string; publicKey: string; signature: string; signedAt: string } | null;
  anchor: {
    network: string;
    contractId: string;
    batchId: string;
    root: string;
    leafIndex: number;
    status: string;
    transaction: string | null;
    transactionUrl: string | null;
    anchoredAt: string | null;
  } | null;
  attestations: Attestation[];
  policy: { name: string; version: number; hash: string } | null;
};
export type EventSummary = {
  id: string;
  kind: ProofBundle['event']['kind'];
  subjectId: string;
  digest: string;
  state: ProofBundle['event']['state'];
  signed: boolean;
  createdAt: string;
  summary: string;
};
export type NearConfig = {
  enabled: boolean;
  network: string;
  contractId: string;
  contractUrl: string | null;
  policy: { version: number; hash: string };
};
export type NearWallet = { network: string; accountId: string | null; publicKey: string | null };

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const nearApi = {
  config: () => api<NearConfig>('/near/config'),
  wallet: () => api<NearWallet>('/near/wallet'),
  challenge: (accountId: string) =>
    api<{ message: string; nonce: string; recipient: string }>('/near/wallet/challenge', json({ accountId })),
  connect: (body: { accountId: string; publicKey: string; signature: string }) =>
    api<NearWallet>('/near/wallet/connect', json(body)),
  disconnect: () => api<NearWallet>('/near/wallet', { method: 'DELETE' }),
  events: (patientId: string) =>
    api<{ network: string; contractId: string; events: EventSummary[] }>(`/near/patients/${patientId}/events`),
  event: (id: string) => api<ProofBundle>(`/near/events/${id}`),
  subject: (kind: 'plan' | 'activity' | 'gate_decision', subjectId: string) =>
    api<ProofBundle>(`/near/subjects/${kind}/${subjectId}`),
  sign: (id: string, body: { publicKey: string; signature: string }) =>
    api<ProofBundle>(`/near/events/${id}/signature`, json(body)),
  verify: (bundle: unknown) => api<{ checks: Check[] }>('/near/verify', json(bundle)),
};

export const kindLabel: Record<ProofBundle['event']['kind'], string> = {
  plan_version: 'Confirmed plan',
  activity: 'Care activity',
  gate_decision: 'Tomo decision',
};
