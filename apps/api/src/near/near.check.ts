// End-to-end NEAR trust checks against the local database (synthetic data, cleaned up after).
// Run: pnpm --filter @kuvos-near/api check:near
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ed25519 } from '@noble/curves/ed25519';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { signMessage } from 'near-api-js/nep413';
import { config as loadEnv } from 'dotenv';
import { PrismaService } from '../database/prisma.service';
import {
  canonical,
  eventLeaf,
  eventNonce,
  hash,
  merkleProof,
  merkleRoot,
  nep413Hash,
  SIGN_RECIPIENT,
  signingMessage,
  verifyNep413,
  verifyProof,
  walletMessage,
} from './near-protocol';
import { NearPublisher } from './near-publisher.service';
import { NearService } from './near.service';
import { gate, GATE_HASH, GATE_RULES } from './tomo-gate';
import { verifyAiSignature, verifyBundle } from './verify-core';

loadEnv({ path: '../../.env' });

class OfflineNear extends NearService {
  // The full-access-key lookup is covered by verify-core's online checks; here RPC is offline.
  protected override fullAccess() {
    return Promise.resolve(true);
  }
}

type Payload = {
  body: {
    planVersion: { digest: string };
    decision: string;
    modelCalled: boolean;
  };
};
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

async function protocolChecks() {
  // Canonical JSON is key-order independent and drops undefined.
  assert.equal(
    canonical({ b: 1, a: [true, null, 'x'], c: undefined }),
    '{"a":[true,null,"x"],"b":1}',
  );
  assert.throws(() => canonical({ when: new Date() }));

  // Merkle proofs for every leaf of an odd-sized tree.
  const leaves = Array.from({ length: 7 }, (_, i) =>
    eventLeaf(hash(`leaf-${i}`)),
  );
  const root = merkleRoot(leaves);
  leaves.forEach((leaf, i) =>
    assert(verifyProof(leaf, merkleProof(leaves, i), root)),
  );
  assert(!verifyProof(leaves[0], merkleProof(leaves, 1), root));

  // NEP-413: near-api-js signs, Kuvos verifies (interoperability with real NEAR wallets).
  const keyPair = KeyPair.fromRandom('ed25519');
  const account = new Account(
    'kuvos-check.testnet',
    new JsonRpcProvider({ url: 'http://127.0.0.1:1' }),
    keyPair.toString(),
  );
  const nonce = randomBytes(32);
  const message = walletMessage(
    'kuvos-check.testnet',
    hash('user'),
    new Date().toISOString(),
  );
  const signed = await signMessage({
    signerAccount: account,
    payload: { message, recipient: SIGN_RECIPIENT, nonce },
  });
  const signature = Buffer.from(signed.signature).toString('base64');
  const publicKey = signed.publicKey.toString();
  assert(
    verifyNep413({
      message,
      nonce: hex(nonce),
      recipient: SIGN_RECIPIENT,
      publicKey,
      signature,
    }),
  );
  assert(
    !verifyNep413({
      message: `${message}!`,
      nonce: hex(nonce),
      recipient: SIGN_RECIPIENT,
      publicKey,
      signature,
    }),
  );
  assert(
    !verifyNep413({
      message,
      nonce: hex(nonce),
      recipient: 'other-app',
      publicKey,
      signature,
    }),
  );

  // NEAR AI provider_tee signature format and rejection of Gateway-only signatures.
  const secret = ed25519.utils.randomPrivateKey();
  const text = `Qwen/Qwen3.8-27B:${hash('request')}:${hash('response')}`;
  const record = {
    purpose: 'ModelExtraction',
    model: 'Qwen/Qwen3.8-27B',
    signatureKind: 'provider_tee',
    signingAlgo: 'ed25519',
    signingAddress: hex(ed25519.getPublicKey(secret)),
    signedText: text,
    signature: hex(ed25519.sign(Buffer.from(text), secret)),
  };
  assert.equal(verifyAiSignature(record).ok, true);
  assert.equal(
    verifyAiSignature({ ...record, signatureKind: 'gateway' }).ok,
    false,
  );
  assert.equal(
    verifyAiSignature({ ...record, signedText: `${text}0` }).ok,
    false,
  );
  return keyPair;
}

function gateChecks() {
  const cases: [string, string, string][] = [
    ['I have chest pain and can’t breathe', 'BLOCK', 'emergency'],
    ['Can I double my dose tonight?', 'ESCALATE', 'escalate'],
    ['I feel dizzy after the new tablets', 'ESCALATE', 'escalate'],
    ['Should I eat before my walk?', 'BLOCK', 'block'],
    ['What does this meal mean for my plan?', 'BLOCK', 'block'],
    ['Remember that I felt dizzy on Tuesday', 'ALLOW', 'note'],
    ['What is next today?', 'ALLOW', 'allow'],
    ['Explain my morning exercises', 'ALLOW', 'allow'],
  ];
  for (const [text, decision, rule] of cases) {
    const result = gate(text);
    assert.equal(result.decision, decision, text);
    assert.equal(result.rule, rule, text);
  }
  assert.equal(
    GATE_HASH,
    hash(canonical(JSON.parse(JSON.stringify(GATE_RULES)))),
  );
  assert.match(GATE_HASH, /^[a-f0-9]{64}$/);
}

async function cleanup(prisma: PrismaService, userIds: string[]) {
  const patients = await prisma.patientProfile.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true },
  });
  const patientIds = patients.map((patient) => patient.id);
  await prisma.nearEvent.deleteMany({
    where: { patientId: { in: patientIds } },
  });
  await prisma.nearBatch.deleteMany({
    where: { contract: 'anchor.kuvos-check.testnet' },
  });
  await prisma.occurrenceLog.deleteMany({
    where: { actorUserId: { in: userIds } },
  });
  await prisma.planItem.deleteMany({
    where: { plan: { patientId: { in: patientIds } } },
  });
  await prisma.extraction.deleteMany({
    where: { document: { patientId: { in: patientIds } } },
  });
  await prisma.plan.deleteMany({ where: { patientId: { in: patientIds } } });
  await prisma.document.deleteMany({
    where: { patientId: { in: patientIds } },
  });
  await prisma.patientProfile.deleteMany({ where: { id: { in: patientIds } } });
}

async function flowChecks(signer: KeyPair) {
  const config = new ConfigService({
    ...process.env,
    NEAR_ENABLED: 'true',
    NEAR_CONTRACT_ID: 'anchor.kuvos-check.testnet',
  });
  const prisma = new PrismaService(config);
  const near = new OfflineNear(prisma, config);
  const publisher = new NearPublisher(prisma, config, near);
  const userId = `near-check-${randomUUID()}`;
  const otherId = `near-check-${randomUUID()}`;
  let patientId = '';
  // Remove leftovers from an interrupted earlier run.
  const stale = await prisma.user.findMany({
    where: { id: { startsWith: 'near-check-' } },
    select: { id: true },
  });
  await cleanup(
    prisma,
    stale.map((user) => user.id),
  );
  await prisma.user.deleteMany({
    where: { id: { startsWith: 'near-check-' } },
  });
  try {
    await prisma.user.createMany({
      data: [
        {
          id: userId,
          name: 'Synthetic Caregiver',
          email: `${userId}@example.test`,
        },
        {
          id: otherId,
          name: 'Synthetic Stranger',
          email: `${otherId}@example.test`,
        },
      ],
    });
    const patient = await prisma.patientProfile.create({
      data: {
        name: 'Synthetic Patient',
        timezone: 'Asia/Kolkata',
        createdById: userId,
      },
    });
    patientId = patient.id;
    await prisma.careMembership.create({
      data: { patientId, userId, role: 'CAREGIVER' },
    });
    const document = await prisma.document.create({
      data: {
        patientId,
        uploadedById: userId,
        fileName: 'synthetic.pdf',
        path: '/synthetic.pdf',
        mimeType: 'application/pdf',
        size: 1,
      },
    });
    const attestation = {
      provider: 'near-ai-cloud',
      purpose: 'ModelExtraction',
      model: 'Qwen/Qwen3.8-27B',
      signatureKind: 'provider_tee',
      signingAlgo: 'ed25519',
      signingAddress: '',
      signedText: '',
      signature: '',
    };
    const secret = ed25519.utils.randomPrivateKey();
    attestation.signingAddress = hex(ed25519.getPublicKey(secret));
    attestation.signedText = `Qwen/Qwen3.8-27B:${hash('req')}:${hash('res')}`;
    attestation.signature = hex(
      ed25519.sign(Buffer.from(attestation.signedText), secret),
    );
    const plan = await prisma.plan.create({
      data: {
        patientId,
        name: 'Synthetic Cardiac',
        suggestedName: 'Cardiac',
        confirmedById: userId,
        timezone: 'Asia/Kolkata',
      },
    });
    const extraction = await prisma.extraction.create({
      data: {
        documentId: document.id,
        planId: plan.id,
        status: 'CONFIRMED',
        result: { evaluation: {}, attestations: [attestation] },
      },
    });
    const item = await prisma.planItem.create({
      data: {
        planId: plan.id,
        extractionId: extraction.id,
        candidateId: 'c1',
        category: 'medication',
        instructionText: 'Synthetic tablet once daily after breakfast',
        actionText: 'Synthetic tablet after breakfast',
        fields: {},
        schedule: { kind: 'daily' },
        evidenceSpanIds: ['s1'],
      },
    });
    const occurrence = await prisma.occurrence.create({
      data: { planItemId: item.id, scheduledAt: new Date() },
    });

    // Plan confirmation commits version 1; closing commits version 2 linked to version 1.
    const v1 = await near.planVersion(prisma, plan.id, userId, 'confirmed');
    assert(v1 && v1.subjectId === `${plan.id}:v1`);
    assert.equal(hash(v1.payload), v1.digest);
    assert(
      !v1.payload.includes('Synthetic Patient'),
      'Patient name is not part of the commitment',
    );
    const again = await near.planVersion(prisma, plan.id, userId, 'confirmed');
    assert.equal(again!.subjectId, `${plan.id}:v2`);
    assert.equal(again!.previousId, v1.id);

    // Done, then undo: each gets its own commitment, the second links to the first.
    const done = await prisma.occurrenceLog.create({
      data: {
        occurrenceId: occurrence.id,
        actorUserId: userId,
        action: 'done',
      },
    });
    const doneEvent = await near.activity(prisma, done.id);
    const undo = await prisma.occurrenceLog.create({
      data: {
        occurrenceId: occurrence.id,
        actorUserId: userId,
        action: 'undone',
      },
    });
    const undoEvent = await near.activity(prisma, undo.id);
    assert.equal(undoEvent!.previousId, doneEvent!.id);
    assert.equal(
      (JSON.parse(doneEvent!.payload) as Payload).body.planVersion.digest,
      again!.digest,
    );
    assert.equal(
      (await near.activity(prisma, done.id))!.id,
      doneEvent!.id,
      'Idempotent per log',
    );

    // Gate decision: only salted hashes of the words are committed.
    const turn = await prisma.chatTurn.create({
      data: {
        userId,
        patientId,
        requestId: randomUUID(),
        text: 'Can I double my dose?',
        reply: {},
      },
    });
    const decision = gate(turn.text);
    const gateEvent = await near.gateDecision(prisma, turn, decision, {
      text: decision.reply!,
      kind: 'boundary',
      links: [],
    });
    assert(!gateEvent!.payload.includes('double my dose'));
    assert.equal(
      (JSON.parse(gateEvent!.payload) as Payload).body.decision,
      'ESCALATE',
    );
    assert.equal(
      (JSON.parse(gateEvent!.payload) as Payload).body.modelCalled,
      false,
    );

    // Wallet link with NEP-413, then the person signs their own Done statement.
    const accountId = 'kuvos-check.testnet';
    const challenge = await near.challenge(userId, { accountId });
    const publicKey = signer.getPublicKey().toString();
    const sign = (message: string, nonce: string) =>
      Buffer.from(
        signer.sign(
          nep413Hash(message, Buffer.from(nonce, 'hex'), SIGN_RECIPIENT),
        ).signature,
      ).toString('base64');
    await assert.rejects(
      near.connect(userId, {
        accountId,
        publicKey,
        signature: sign(`${challenge.message}x`, challenge.nonce),
      }),
    );
    const wallet = await near.connect(userId, {
      accountId,
      publicKey,
      signature: sign(challenge.message, challenge.nonce),
    });
    assert.equal(wallet.accountId, accountId);
    await assert.rejects(
      near.connect(userId, {
        accountId,
        publicKey,
        signature: sign(challenge.message, challenge.nonce),
      }),
      'One-use challenge',
    );
    const message = signingMessage(
      'activity',
      doneEvent!.id,
      doneEvent!.digest,
    );
    await assert.rejects(
      near.sign(userId, doneEvent!.id, {
        publicKey,
        signature: sign(message, hash('wrong')),
      }),
    );
    await near.sign(userId, doneEvent!.id, {
      publicKey,
      signature: sign(message, eventNonce(doneEvent!.digest)),
    });
    await assert.rejects(
      near.sign(userId, gateEvent!.id, { publicKey, signature: 'x' }),
      'Gate decisions are not signed',
    );
    await assert.rejects(
      near.get(otherId, doneEvent!.id),
      'Non-members cannot read commitments',
    );

    // Batch, then verify the exported bundle offline. Tampering is detected.
    await publisher.freeze();
    const bundle = await near.get(userId, doneEvent!.id);
    assert(bundle.anchor && bundle.signature);
    const checks = await verifyBundle(JSON.parse(JSON.stringify(bundle)));
    assert(
      checks.every((check) => check.ok !== false),
      JSON.stringify(checks),
    );
    assert(
      checks.some((check) => check.name === 'NEP-413 signature' && check.ok),
    );
    assert(
      checks.some((check) => check.name === 'Merkle inclusion' && check.ok),
    );
    const tampered = JSON.parse(JSON.stringify(bundle)) as {
      event: { payload: string };
    };
    tampered.event.payload = tampered.event.payload.replace(
      '"done"',
      '"skipped"',
    );
    assert(
      (await verifyBundle(tampered)).some(
        (check) => check.name === 'Commitment digest' && check.ok === false,
      ),
    );

    const planBundle = await near.subject(userId, 'plan', plan.id);
    const planChecks = await verifyBundle(
      JSON.parse(JSON.stringify(planBundle)),
    );
    assert(
      planChecks.some(
        (check) => check.name.startsWith('NEAR AI TEE signature') && check.ok,
      ),
      JSON.stringify(planChecks),
    );

    const gateBundle = await near.get(userId, gateEvent!.id);
    const gateChecks = await verifyBundle(
      JSON.parse(JSON.stringify(gateBundle)),
    );
    assert(
      gateChecks.some((check) => check.name === 'Tomo gate rules' && check.ok),
      JSON.stringify(gateChecks),
    );
  } finally {
    await cleanup(prisma, [userId, otherId]);
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  }
}

async function main() {
  const signer = await protocolChecks();
  gateChecks();
  await flowChecks(signer);
  console.log(
    'NEAR checks passed: canonical commitments, Merkle proofs, NEP-413 interop with near-api-js, provider_tee signature checks, Tomo gate routes and rules hash, plan versions, linked activity commitments, salted gate decisions, one-use wallet link, actor-only signing, access control, batching and tamper detection.',
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
