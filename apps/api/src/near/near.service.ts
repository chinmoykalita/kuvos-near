import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { ChatReply } from '../chat/chat.policy';
import type { AiAttestation } from './near-ai';
import {
  canonical,
  EVENT_VERSION,
  eventLeaf,
  eventNonce,
  type EventKind,
  fullAccessKeyOf,
  hash,
  merkleProof,
  salt,
  SIGN_RECIPIENT,
  signingMessage,
  validAccountId,
  verifyNep413,
  walletMessage,
} from './near-protocol';
import { GATE_HASH, GATE_RULES, type GateResult } from './tomo-gate';

type Database = Prisma.TransactionClient | PrismaService;
type Json = Record<string, unknown>;

const object = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};

// Prisma JSON is plain data, but Dates and class instances must become strings before hashing.
const plain = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value ?? null));

// Only the fields a verifier needs; the Intel quote stays in the private run artifact.
export function attestationSummary(value: unknown) {
  const a = object(value) as Partial<AiAttestation>;
  return {
    provider: a.provider ?? 'near-ai-cloud',
    purpose: a.purpose ?? '',
    model: a.model ?? '',
    completionId: a.completionId ?? '',
    signatureKind: a.signatureKind ?? '',
    signedText: a.signedText ?? '',
    signature: a.signature ?? '',
    signingAlgo: a.signingAlgo ?? '',
    signingAddress: a.signingAddress ?? '',
    tcbStatus: a.tcbStatus ?? null,
    composeHash: a.composeHash ?? null,
    e2ee: a.e2ee ?? false,
  };
}

@Injectable()
export class NearService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  enabled() {
    return this.config.get('NEAR_ENABLED', 'true') === 'true';
  }

  network() {
    return this.config.get<string>('NEAR_NETWORK') || 'testnet';
  }

  rpcUrl() {
    return (
      this.config.get<string>('NEAR_RPC_URL') ||
      (this.network() === 'mainnet'
        ? 'https://rpc.mainnet.fastnear.com'
        : 'https://test.rpc.fastnear.com')
    );
  }

  contractId() {
    return this.config.get<string>('NEAR_CONTRACT_ID') || '';
  }

  explorer(kind: 'tx' | 'account', id: string) {
    const base =
      this.network() === 'mainnet'
        ? 'https://nearblocks.io'
        : 'https://testnet.nearblocks.io';
    return `${base}/${kind === 'tx' ? 'txns' : 'address'}/${id}`;
  }

  private async record(
    database: Database,
    input: {
      kind: EventKind;
      subjectId: string;
      patientId: string;
      actorId: string | null;
      body: Json;
      previousId?: string | null;
    },
  ) {
    const existing = await database.nearEvent.findUnique({
      where: {
        kind_subjectId: { kind: input.kind, subjectId: input.subjectId },
      },
    });
    if (existing) return existing;
    const id = randomUUID();
    const createdAt = new Date();
    const payload = canonical({
      version: EVENT_VERSION,
      id,
      kind: input.kind,
      subjectId: input.subjectId,
      patientId: input.patientId,
      actorId: input.actorId,
      previousId: input.previousId ?? null,
      createdAt: createdAt.toISOString(),
      salt: salt(),
      body: plain(input.body),
    });
    return database.nearEvent.create({
      data: {
        id,
        kind: input.kind,
        subjectId: input.subjectId,
        patientId: input.patientId,
        actorId: input.actorId,
        payload,
        digest: hash(payload),
        previousId: input.previousId ?? null,
        createdAt,
      },
    });
  }

  // A plan version commits to every confirmed item, its source evidence IDs, the immutable
  // extraction result and the NEAR AI TEE proofs that produced the draft.
  async planVersion(
    database: Database,
    planId: string,
    actorId: string,
    reason: 'confirmed' | 'attached' | 'closed',
  ) {
    if (!this.enabled()) return null;
    const plan = await database.plan.findUniqueOrThrow({
      where: { id: planId },
      include: {
        items: { orderBy: { id: 'asc' } },
        extractions: {
          orderBy: { id: 'asc' },
          select: { id: true, documentId: true, result: true },
        },
      },
    });
    const previous = await database.nearEvent.findFirst({
      where: { kind: 'plan_version', subjectId: { startsWith: `${planId}:v` } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, subjectId: true },
    });
    const version = previous
      ? Number(previous.subjectId.split(':v')[1]) + 1
      : 1;
    return this.record(database, {
      kind: 'plan_version',
      subjectId: `${planId}:v${version}`,
      patientId: plan.patientId,
      actorId,
      previousId: previous?.id,
      body: {
        reason,
        planVersion: version,
        plan: {
          id: plan.id,
          name: plan.name,
          status: plan.status,
          timezone: plan.timezone,
        },
        items: plan.items.map((item) => ({
          id: item.id,
          extractionId: item.extractionId,
          candidateId: item.candidateId,
          category: item.category,
          instructionText: item.instructionText,
          actionText: item.actionText,
          explanation: item.explanation,
          fields: item.fields,
          schedule: item.schedule,
          evidenceSpanIds: item.evidenceSpanIds,
          physio: item.physio,
        })),
        sources: plan.extractions.map((extraction) => ({
          extractionId: extraction.id,
          documentId: extraction.documentId,
          resultDigest: hash(canonical(plain(extraction.result))),
          aiAttestations: (Array.isArray(object(extraction.result).attestations)
            ? (object(extraction.result).attestations as unknown[])
            : []
          ).map(attestationSummary),
        })),
      },
    });
  }

  async activity(database: Database, logId: string) {
    if (!this.enabled()) return null;
    const log = await database.occurrenceLog.findUniqueOrThrow({
      where: { id: logId },
      include: {
        occurrence: { include: { planItem: { include: { plan: true } } } },
      },
    });
    const item = log.occurrence.planItem;
    const earlierLogs = await database.occurrenceLog.findMany({
      where: { occurrenceId: log.occurrenceId, id: { not: logId } },
      select: { id: true },
    });
    const [previous, planVersion] = await Promise.all([
      // Undo and re-marks append a new commitment linked to the earlier one; nothing is overwritten.
      database.nearEvent.findFirst({
        where: {
          kind: 'activity',
          subjectId: { in: earlierLogs.map((entry) => entry.id) },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      }),
      database.nearEvent.findFirst({
        where: {
          kind: 'plan_version',
          subjectId: { startsWith: `${item.planId}:v` },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, digest: true },
      }),
    ]);
    return this.record(database, {
      kind: 'activity',
      subjectId: logId,
      patientId: item.plan.patientId,
      actorId: log.actorUserId,
      previousId: previous?.id,
      body: {
        occurrenceId: log.occurrenceId,
        planItemId: item.id,
        candidateId: item.candidateId,
        extractionId: item.extractionId,
        planVersion: planVersion
          ? { eventId: planVersion.id, digest: planVersion.digest }
          : null,
        action: log.action,
        reason: log.reason,
        note: log.note,
        recordedAt: log.createdAt.toISOString(),
        scheduledAt: log.occurrence.scheduledAt.toISOString(),
        timezone: item.plan.timezone,
      },
    });
  }

  // The gate decision commits to the rules version, the confirmed plans in scope and salted
  // hashes of the words, never the words themselves.
  async gateDecision(
    database: Database,
    turn: { id: string; userId: string; patientId: string; text: string },
    result: GateResult,
    reply: ChatReply,
  ) {
    if (!this.enabled()) return null;
    const plans = await database.plan.findMany({
      where: { patientId: turn.patientId, status: 'ACTIVE' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const versions = await Promise.all(
      plans.map((plan) =>
        database.nearEvent.findFirst({
          where: {
            kind: 'plan_version',
            subjectId: { startsWith: `${plan.id}:v` },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { digest: true },
        }),
      ),
    );
    const scope = versions.map((version) => version?.digest ?? null);
    const textSalt = randomBytes(32).toString('hex');
    return this.record(database, {
      kind: 'gate_decision',
      subjectId: turn.id,
      patientId: turn.patientId,
      actorId: turn.userId,
      body: {
        policy: {
          name: GATE_RULES.name,
          version: GATE_RULES.version,
          hash: GATE_HASH,
        },
        decision: result.decision,
        rule: result.rule,
        modelCalled: (reply.attestations?.length ?? 0) > 0,
        planScopeDigest: hash(canonical(scope)),
        inputDigest: hash(`${textSalt}:${turn.text}`),
        outputDigest: hash(`${textSalt}:${reply.text}`),
        textSalt,
        attestations: (reply.attestations ?? []).map(attestationSummary),
      },
    });
  }

  // ---------- Reads ----------

  private accessible(userId: string): Prisma.NearEventWhereInput {
    return { patient: { memberships: { some: { userId, revokedAt: null } } } };
  }

  private state(event: {
    signature: string | null;
    batch?: { anchoredAt: Date | null } | null;
  }) {
    return event.batch?.anchoredAt
      ? 'anchored'
      : event.signature
        ? 'signed'
        : 'recorded';
  }

  async list(userId: string, patientId: string) {
    const member = await this.prisma.careMembership.findFirst({
      where: { userId, patientId, revokedAt: null },
    });
    if (!member) throw new NotFoundException('Patient not found.');
    // ponytail: newest 100 commitments; add cursor pagination when history grows.
    const events = await this.prisma.nearEvent.findMany({
      where: { patientId },
      include: { batch: { select: { anchoredAt: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const bodies = new Map(
      events.map((event) => [
        event.id,
        object(object(JSON.parse(event.payload)).body),
      ]),
    );
    // Activity titles name the task; the commitment itself only holds the plan item ID.
    const items = await this.prisma.planItem.findMany({
      where: {
        id: {
          in: [...bodies.values()]
            .map((body) => body.planItemId)
            .filter((id): id is string => typeof id === 'string'),
        },
      },
      select: { id: true, actionText: true, instructionText: true },
    });
    const taskName = new Map(
      items.map((item) => [item.id, item.actionText || item.instructionText]),
    );
    const actionLabel = (action: unknown) => {
      const text = typeof action === 'string' ? action.toLowerCase() : '';
      return text === 'done'
        ? 'Done'
        : text === 'skipped' || text === 'skip'
          ? 'Skipped'
          : text
            ? text[0].toUpperCase() + text.slice(1)
            : 'Activity';
    };
    return {
      network: this.network(),
      contractId: this.contractId(),
      events: events.map((event) => {
        const body = bodies.get(event.id)!;
        return {
          id: event.id,
          kind: event.kind,
          subjectId: event.subjectId,
          digest: event.digest,
          state: this.state(event),
          signed: !!event.signature,
          createdAt: event.createdAt,
          summary:
            event.kind === 'plan_version'
              ? `${object(body.plan).name as string} · version ${body.planVersion as number} (${body.reason as string})`
              : event.kind === 'activity'
                ? [
                    actionLabel(body.action),
                    taskName.get(body.planItemId as string),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : `Tomo ${body.decision as string} (${body.rule as string})`,
        };
      }),
    };
  }

  async subject(userId: string, kind: string, subjectId: string) {
    if (!['plan_version', 'activity', 'gate_decision', 'plan'].includes(kind))
      throw new NotFoundException();
    const event =
      kind === 'plan'
        ? await this.prisma.nearEvent.findFirst({
            where: {
              kind: 'plan_version',
              subjectId: { startsWith: `${subjectId}:v` },
              ...this.accessible(userId),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          })
        : await this.prisma.nearEvent.findFirst({
            where: { kind, subjectId, ...this.accessible(userId) },
            select: { id: true },
          });
    if (!event)
      throw new NotFoundException('No NEAR commitment for this record yet.');
    return this.get(userId, event.id);
  }

  async get(userId: string, id: string) {
    const event = await this.prisma.nearEvent.findFirst({
      where: { id, ...this.accessible(userId) },
      include: { batch: true },
    });
    if (!event) throw new NotFoundException('Commitment not found.');
    const payload = JSON.parse(event.payload) as Json;
    const body = object(payload.body);
    const batch = event.batch;
    const list = (value: unknown): unknown[] =>
      Array.isArray(value) ? (value as unknown[]) : [];
    const attestations: unknown[] = [
      ...list(body.attestations),
      ...list(body.sources).flatMap((source) =>
        list(object(source).aiAttestations),
      ),
    ];
    return {
      version: 'kuvos-near-bundle-v1',
      event: {
        id: event.id,
        kind: event.kind,
        subjectId: event.subjectId,
        digest: event.digest,
        payload: event.payload,
        state: this.state(event),
        createdAt: event.createdAt,
        actorId: event.actorId,
      },
      signing: {
        message: signingMessage(
          event.kind as EventKind,
          event.id,
          event.digest,
        ),
        nonce: eventNonce(event.digest),
        recipient: SIGN_RECIPIENT,
      },
      signature: event.signature
        ? {
            accountId: event.signerAccountId,
            publicKey: event.signerPublicKey,
            signature: event.signature,
            signedAt: event.signedAt,
          }
        : null,
      anchor:
        batch && event.leafIndex !== null
          ? {
              network: batch.network,
              contractId: batch.contract,
              batchId: batch.id,
              root: batch.root,
              leaf: eventLeaf(event.digest),
              leafIndex: event.leafIndex,
              proof: merkleProof(batch.leaves as string[], event.leafIndex),
              status: batch.status,
              transaction: batch.transaction,
              transactionUrl: batch.transaction
                ? this.explorer('tx', batch.transaction)
                : null,
              anchoredAt: batch.anchoredAt,
            }
          : null,
      attestations,
      policy:
        event.kind === 'gate_decision'
          ? {
              ...object(body.policy),
              rules: GATE_RULES,
              contractId: this.contractId(),
              network: this.network(),
            }
          : null,
    };
  }

  // ---------- NEAR account link and NEP-413 signatures ----------

  async wallet(userId: string) {
    const wallet = await this.prisma.nearWallet.findUnique({
      where: { userId },
    });
    return {
      network: this.network(),
      accountId: wallet?.accountId ?? null,
      publicKey: wallet?.publicKey ?? null,
      connectedAt: wallet?.connectedAt ?? null,
    };
  }

  async challenge(userId: string, value: unknown) {
    const accountId = object(value).accountId;
    if (!validAccountId(accountId))
      throw new BadRequestException('A valid NEAR account ID is required.');
    const expires = new Date(Date.now() + 10 * 60_000);
    const message = walletMessage(
      accountId,
      hash(`kuvos-user:${userId}`),
      expires.toISOString(),
    );
    const nonce = randomBytes(32).toString('hex');
    await this.prisma.nearWallet.upsert({
      where: { userId },
      create: {
        userId,
        pendingAccountId: accountId,
        challenge: message,
        challengeNonce: nonce,
        challengeExpires: expires,
      },
      update: {
        pendingAccountId: accountId,
        challenge: message,
        challengeNonce: nonce,
        challengeExpires: expires,
      },
    });
    return {
      message,
      nonce,
      recipient: SIGN_RECIPIENT,
      expiresAt: expires.toISOString(),
    };
  }

  async connect(userId: string, value: unknown) {
    const { accountId, publicKey, signature } = object(value);
    const pending = await this.prisma.nearWallet.findUnique({
      where: { userId },
    });
    if (
      !pending?.pendingAccountId ||
      pending.pendingAccountId !== accountId ||
      !pending.challenge ||
      !pending.challengeNonce ||
      !pending.challengeExpires ||
      pending.challengeExpires <= new Date() ||
      typeof publicKey !== 'string' ||
      typeof signature !== 'string' ||
      !verifyNep413({
        message: pending.challenge,
        nonce: pending.challengeNonce,
        recipient: SIGN_RECIPIENT,
        publicKey,
        signature,
      })
    )
      throw new BadRequestException('NEAR signature is invalid or expired.');
    if (!(await this.fullAccess(accountId, publicKey)))
      throw new BadRequestException(
        'That key is not a full-access key of this NEAR account.',
      );
    const updated = await this.prisma.nearWallet.updateMany({
      where: { userId, challenge: pending.challenge },
      data: {
        accountId,
        publicKey,
        connectedAt: new Date(),
        pendingAccountId: null,
        challenge: null,
        challengeNonce: null,
        challengeExpires: null,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('This challenge was already used.');
    return this.wallet(userId);
  }

  async disconnect(userId: string) {
    await this.prisma.nearWallet.deleteMany({ where: { userId } });
    return this.wallet(userId);
  }

  protected async fullAccess(accountId: string, publicKey: string) {
    try {
      return await fullAccessKeyOf(this.rpcUrl(), accountId, publicKey);
    } catch {
      throw new ServiceUnavailableException(
        'NEAR RPC is unavailable. Please retry.',
      );
    }
  }

  // Only the person who made the statement can sign it, with their linked account.
  async sign(userId: string, id: string, value: unknown) {
    const { signature, publicKey } = object(value);
    const [event, wallet] = await Promise.all([
      this.prisma.nearEvent.findFirst({
        where: { id, ...this.accessible(userId) },
      }),
      this.prisma.nearWallet.findUnique({ where: { userId } }),
    ]);
    if (!event) throw new NotFoundException('Commitment not found.');
    if (event.kind === 'gate_decision')
      throw new BadRequestException('Tomo decisions are not signed by people.');
    if (event.actorId !== userId)
      throw new BadRequestException(
        'Only the person who recorded this can sign it.',
      );
    if (!wallet?.accountId || !wallet.publicKey)
      throw new BadRequestException('Link a NEAR account first.');
    if (publicKey !== wallet.publicKey)
      throw new BadRequestException('Sign with the linked NEAR key.');
    if (
      typeof signature !== 'string' ||
      !verifyNep413({
        message: signingMessage(
          event.kind as EventKind,
          event.id,
          event.digest,
        ),
        nonce: eventNonce(event.digest),
        recipient: SIGN_RECIPIENT,
        publicKey,
        signature,
      })
    )
      throw new BadRequestException('NEAR signature is invalid.');
    if (!(await this.fullAccess(wallet.accountId, publicKey)))
      throw new BadRequestException(
        'That key is no longer a full-access key of the linked account.',
      );
    const result = await this.prisma.nearEvent.updateMany({
      where: { id, signature: null },
      data: {
        signature,
        signerAccountId: wallet.accountId,
        signerPublicKey: publicKey,
        signedAt: new Date(),
      },
    });
    if (!result.count && event.signature !== signature)
      throw new ConflictException(
        'This commitment already has a different signature.',
      );
    return this.get(userId, id);
  }
}
