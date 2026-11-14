import { ed25519 } from '@noble/curves/ed25519';
import {
  canonical,
  eventLeaf,
  eventNonce,
  type EventKind,
  EVENT_KINDS,
  fullAccessKeyOf,
  hash,
  isHash,
  type ProofStep,
  SIGN_RECIPIENT,
  signingMessage,
  verifyNep413,
  verifyProof,
  viewBatch,
  viewPolicy,
} from './near-protocol';

// Re-runs every check in an exported proof bundle. Offline checks need only the bundle;
// online checks read NEAR final state through public RPC. No Kuvos server is trusted.

export type Check = { name: string; ok: boolean | null; detail: string };
type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};

export function verifyAiSignature(value: unknown): Check {
  const a = object(value);
  const label = (value: unknown, fallback = '') =>
    typeof value === 'string' && value ? value : fallback;
  const name = `NEAR AI TEE signature (${label(a.purpose, 'model call')})`;
  try {
    if (a.signatureKind !== 'provider_tee')
      return {
        name,
        ok: false,
        detail: `Signature kind is ${String(a.signatureKind)}, not provider_tee: model TEE execution is not proven.`,
      };
    if (a.signingAlgo !== 'ed25519')
      return {
        name,
        ok: null,
        detail: 'Only ed25519 signatures are checked offline.',
      };
    const text = String(a.signedText);
    const parts = text.split(':');
    if (
      parts.length < 3 ||
      !isHash(parts.at(-1)) ||
      !isHash(parts.at(-2)) ||
      parts.slice(0, -2).join(':') !== a.model
    )
      return {
        name,
        ok: false,
        detail:
          'Signed text is not <model>:<request sha256>:<response sha256>.',
      };
    const ok = ed25519.verify(
      Buffer.from(String(a.signature).replace(/^0x/, ''), 'hex'),
      Buffer.from(text, 'utf8'),
      Buffer.from(String(a.signingAddress).replace(/^0x/, ''), 'hex'),
    );
    return {
      name,
      ok,
      detail: ok
        ? `Model ${String(a.model)} signed the exact request and response hashes with TEE key ${String(a.signingAddress).slice(0, 16)}… (TCB ${label(a.tcbStatus, 'unknown')}).`
        : 'Signature does not match the TEE signing key.',
    };
  } catch {
    return { name, ok: false, detail: 'Malformed signature or key.' };
  }
}

export async function verifyBundle(
  bundle: unknown,
  options: { rpcUrl?: string } = {},
): Promise<Check[]> {
  const checks: Check[] = [];
  const root = object(bundle);
  const event = object(root.event);
  const payloadText = typeof event.payload === 'string' ? event.payload : '';
  let payload: Json = {};
  try {
    payload = object(JSON.parse(payloadText));
  } catch {
    // reported below
  }
  const digest = hash(payloadText);
  checks.push({
    name: 'Commitment digest',
    ok:
      digest === event.digest &&
      payload.id === event.id &&
      payload.kind === event.kind,
    detail:
      digest === event.digest
        ? 'SHA-256 of the private payload matches the committed digest.'
        : 'Payload does not hash to the committed digest.',
  });
  checks.push({
    name: 'Canonical payload',
    ok: (() => {
      try {
        return canonical(JSON.parse(payloadText)) === payloadText;
      } catch {
        return false;
      }
    })(),
    detail: 'Payload is canonical JSON, so the digest is reproducible.',
  });
  const kind = event.kind as EventKind;
  const signature = root.signature ? object(root.signature) : null;
  if (signature && EVENT_KINDS.includes(kind)) {
    const ok = verifyNep413({
      message: signingMessage(kind, String(event.id), String(event.digest)),
      nonce: eventNonce(String(event.digest)),
      recipient: SIGN_RECIPIENT,
      publicKey: String(signature.publicKey),
      signature: String(signature.signature),
    });
    checks.push({
      name: 'NEP-413 signature',
      ok,
      detail: ok
        ? `${String(signature.accountId)} signed this exact digest.`
        : 'The NEAR signature does not match this digest.',
    });
    if (options.rpcUrl) {
      try {
        const full = await fullAccessKeyOf(
          options.rpcUrl,
          String(signature.accountId),
          String(signature.publicKey),
        );
        checks.push({
          name: 'Signer key on NEAR',
          ok: full,
          detail: full
            ? `The key is a full-access key of ${String(signature.accountId)} right now.`
            : 'The key is not (or no longer) a full-access key of that account.',
        });
      } catch {
        checks.push({
          name: 'Signer key on NEAR',
          ok: null,
          detail: 'NEAR RPC unavailable.',
        });
      }
    }
  } else if (kind !== 'gate_decision') {
    checks.push({
      name: 'NEP-413 signature',
      ok: null,
      detail: 'Not signed by a person yet (optional).',
    });
  }

  const anchor = root.anchor ? object(root.anchor) : null;
  if (anchor) {
    const leaf = isHash(event.digest) ? eventLeaf(String(event.digest)) : '';
    const inRoot = verifyProof(
      leaf,
      anchor.proof as ProofStep[],
      String(anchor.root),
    );
    checks.push({
      name: 'Merkle inclusion',
      ok: inRoot,
      detail: inRoot
        ? `Leaf ${String(anchor.leafIndex)} is included in root ${String(anchor.root).slice(0, 16)}….`
        : 'Proof does not reach the root.',
    });
    if (options.rpcUrl) {
      try {
        const onChain = await viewBatch(
          options.rpcUrl,
          String(anchor.contractId),
          String(anchor.batchId),
        );
        const ok = onChain?.root === anchor.root;
        checks.push({
          name: 'Root on NEAR',
          ok,
          detail: ok
            ? `${String(anchor.contractId)} stores this root (block ${onChain!.block_height}, final).`
            : 'The contract does not hold this root.',
        });
      } catch {
        checks.push({
          name: 'Root on NEAR',
          ok: null,
          detail: 'NEAR RPC unavailable.',
        });
      }
    }
  } else {
    checks.push({
      name: 'Anchored on NEAR',
      ok: null,
      detail: 'Waiting for the next batch.',
    });
  }

  for (const attestation of Array.isArray(root.attestations)
    ? root.attestations
    : [])
    checks.push(verifyAiSignature(attestation));

  if (kind === 'gate_decision') {
    const policy = object(root.policy);
    const body = object(payload.body);
    const committed = object(body.policy);
    const rulesHash = policy.rules
      ? hash(canonical(JSON.parse(JSON.stringify(policy.rules))))
      : '';
    const ok = !!rulesHash && rulesHash === committed.hash;
    checks.push({
      name: 'Tomo gate rules',
      ok,
      detail: ok
        ? `Decision ${String(body.decision)} was made under rules v${String(committed.version)} (${rulesHash.slice(0, 16)}…).`
        : 'The committed rules hash does not match the published rules.',
    });
    if (options.rpcUrl && policy.contractId) {
      try {
        const onChain = await viewPolicy(
          options.rpcUrl,
          typeof policy.contractId === 'string' ? policy.contractId : '',
          Number(committed.version),
        );
        checks.push({
          name: 'Rules hash on NEAR',
          ok: onChain?.hash === committed.hash,
          detail: onChain
            ? 'publish_policy holds the same rules hash.'
            : 'This rules version is not published yet.',
        });
      } catch {
        checks.push({
          name: 'Rules hash on NEAR',
          ok: null,
          detail: 'NEAR RPC unavailable.',
        });
      }
    }
    const modelCalled = body.modelCalled === true;
    checks.push({
      name: 'Model use matches decision',
      ok: modelCalled
        ? body.decision === 'ALLOW' && body.rule === 'allow'
        : true,
      detail: modelCalled
        ? 'Only ALLOW reached the model.'
        : 'No model was called for this turn.',
    });
  }
  return checks;
}
