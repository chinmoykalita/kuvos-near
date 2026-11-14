// Pure, dependency-light helpers shared by the API, the publisher and the offline verifier.
// Nothing here touches the database or the network, so `verify-bundle.ts` can re-run every
// check from an exported proof bundle on any machine.
import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519';

export const EVENT_VERSION = 'kuvos-near-event-v1';
export const EVENT_KINDS = [
  'plan_version',
  'activity',
  'gate_decision',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
// NEP-413 messages are prefixed with 2^31 + 413 so they can never be a valid transaction.
const NEP413_TAG = 2 ** 31 + 413;
export const SIGN_RECIPIENT = 'kuvos';

export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (
    value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  throw new Error('Commitment contains an unsupported JSON value.');
}

export function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Every commitment carries 32 random bytes, so a guessable payload (a drug name and a time)
// cannot be confirmed by hashing candidates against the public root.
export function salt(): string {
  return randomBytes(32).toString('hex');
}

// The Merkle leaf commits to the digest only. A NEP-413 signature over the same digest is a
// separate, later endorsement, so signing never has to wait for, or reopen, an anchored batch.
export function eventLeaf(digest: string): string {
  if (!isHash(digest)) throw new Error('Invalid event digest.');
  return hash(Buffer.concat([Buffer.from([0]), Buffer.from(digest, 'hex')]));
}

function parent(left: string, right: string): string {
  return hash(
    Buffer.concat([
      Buffer.from([1]),
      Buffer.from(left, 'hex'),
      Buffer.from(right, 'hex'),
    ]),
  );
}

export function merkleLevels(leaves: string[]): string[][] {
  if (!leaves.length || leaves.some((leaf) => !isHash(leaf)))
    throw new Error('Invalid Merkle leaves.');
  const levels = [[...leaves]];
  while (levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!;
    const next: string[] = [];
    for (let i = 0; i < previous.length; i += 2)
      next.push(parent(previous[i], previous[i + 1] ?? previous[i]));
    levels.push(next);
  }
  return levels;
}

export const merkleRoot = (leaves: string[]) => merkleLevels(leaves).at(-1)![0];

export type ProofStep = { side: 'left' | 'right'; hash: string };

export function merkleProof(leaves: string[], index: number): ProofStep[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length)
    throw new Error('Invalid leaf index.');
  const levels = merkleLevels(leaves);
  const proof: ProofStep[] = [];
  for (const level of levels.slice(0, -1)) {
    proof.push({
      side: index % 2 ? 'left' : 'right',
      hash: level[index ^ 1] ?? level[index],
    });
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyProof(
  leaf: string,
  proof: ProofStep[],
  root: string,
): boolean {
  if (
    !isHash(leaf) ||
    !isHash(root) ||
    !Array.isArray(proof) ||
    proof.length > 32
  )
    return false;
  for (const step of proof) {
    if (!isHash(step?.hash) || !['left', 'right'].includes(step.side))
      return false;
    leaf =
      step.side === 'left' ? parent(step.hash, leaf) : parent(leaf, step.hash);
  }
  return leaf === root;
}

// ---------- NEP-413 (off-chain message signing by a NEAR account) ----------

export function signingMessage(
  kind: EventKind,
  id: string,
  digest: string,
): string {
  const what =
    kind === 'plan_version'
      ? 'I reviewed and confirmed this care plan version against its source document.'
      : kind === 'activity'
        ? 'I recorded this care activity. This is a statement, not proof of treatment.'
        : 'Tomo gate decision.';
  return `Kuvos ${kind.replace('_', ' ')}\nEvent: ${id}\nSHA-256: ${digest}\n${what}`;
}

export function walletMessage(
  accountId: string,
  userHash: string,
  expires: string,
): string {
  return `Link this NEAR account to Kuvos\nAccount: ${accountId}\nKuvos user: ${userHash}\nExpires: ${expires}\nThis only lets the account sign Kuvos care commitments.`;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export function nep413Hash(
  message: string,
  nonce: Uint8Array,
  recipient: string,
  callbackUrl?: string | null,
) {
  if (nonce.length !== 32) throw new Error('NEP-413 nonce must be 32 bytes.');
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(NEP413_TAG);
  const payload = Buffer.concat([
    tag,
    borshString(message),
    Buffer.from(nonce),
    borshString(recipient),
    callbackUrl
      ? Buffer.concat([Buffer.from([1]), borshString(callbackUrl)])
      : Buffer.from([0]),
  ]);
  return createHash('sha256').update(payload).digest();
}

export function nearPublicKeyBytes(publicKey: string): Uint8Array {
  if (typeof publicKey !== 'string' || !publicKey.startsWith('ed25519:'))
    throw new Error('Only ed25519 NEAR keys are supported.');
  const bytes = bs58.decode(publicKey.slice('ed25519:'.length));
  if (bytes.length !== 32) throw new Error('Invalid NEAR public key.');
  return bytes;
}

// Wallets return the signature as base64 (wallet-selector) or base58 (some CLIs).
export function signatureBytes(signature: string): Uint8Array {
  if (typeof signature !== 'string' || signature.length > 200)
    throw new Error('Invalid signature.');
  const base64 = Buffer.from(signature, 'base64');
  if (
    base64.length === 64 &&
    base64.toString('base64').replace(/=+$/, '') ===
      signature.replace(/=+$/, '')
  )
    return base64;
  const base58 = bs58.decode(signature.replace(/^ed25519:/, ''));
  if (base58.length !== 64) throw new Error('Invalid signature.');
  return base58;
}

export function verifyNep413(input: {
  message: string;
  nonce: string; // hex, 32 bytes
  recipient: string;
  publicKey: string;
  signature: string;
  callbackUrl?: string | null;
}): boolean {
  try {
    const digest = nep413Hash(
      input.message,
      Buffer.from(input.nonce, 'hex'),
      input.recipient,
      input.callbackUrl,
    );
    return ed25519.verify(
      signatureBytes(input.signature),
      digest,
      nearPublicKeyBytes(input.publicKey),
    );
  } catch {
    return false;
  }
}

// Each event's NEP-413 nonce is derived from its digest, so a signature cannot be replayed on
// a different commitment and the verifier can recompute the nonce without extra state.
export const eventNonce = (digest: string) => hash(`kuvos-nep413:${digest}`);

export const validAccountId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 2 &&
  value.length <= 64 &&
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value);

// Confirms through public RPC that `publicKey` is a full-access key of `accountId`. NEP-413
// recommends full-access keys only: a function-call key is scoped to one contract and is not
// the account holder's identity.
export async function fullAccessKeyOf(
  rpcUrl: string,
  accountId: string,
  publicKey: string,
) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'kuvos',
      method: 'query',
      params: {
        request_type: 'view_access_key',
        finality: 'final',
        account_id: accountId,
        public_key: publicKey,
      },
    }),
  });
  const body = (await response.json()) as {
    result?: { permission?: unknown };
    error?: unknown;
  };
  return body.result?.permission === 'FullAccess';
}

export async function viewBatch(
  rpcUrl: string,
  contractId: string,
  batchId: string,
) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'kuvos',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: 'get_batch',
        args_base64: Buffer.from(
          JSON.stringify({ batch_id: batchId }),
        ).toString('base64'),
      },
    }),
  });
  const body = (await response.json()) as {
    result?: { result?: number[] };
    error?: unknown;
  };
  if (!body.result?.result) throw new Error('NEAR RPC view failed.');
  return JSON.parse(
    Buffer.from(body.result.result).toString('utf8') || 'null',
  ) as {
    root: string;
    count: number;
    block_height: number;
    timestamp_ns: number;
  } | null;
}

export async function viewPolicy(
  rpcUrl: string,
  contractId: string,
  version: number,
) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'kuvos',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: 'get_policy',
        args_base64: Buffer.from(JSON.stringify({ version })).toString(
          'base64',
        ),
      },
    }),
  });
  const body = (await response.json()) as { result?: { result?: number[] } };
  if (!body.result?.result) throw new Error('NEAR RPC view failed.');
  return JSON.parse(
    Buffer.from(body.result.result).toString('utf8') || 'null',
  ) as {
    hash: string;
    block_height: number;
    timestamp_ns: number;
  } | null;
}
