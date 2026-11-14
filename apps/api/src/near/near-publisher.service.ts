import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  JsonRpcProvider,
  teraToGas,
  type KeyPairString,
} from 'near-api-js';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { eventLeaf, merkleRoot, viewBatch, viewPolicy } from './near-protocol';
import { NearService } from './near.service';
import { GATE_HASH, GATE_RULES } from './tomo-gate';

const MAX_LEAVES = 256;

// Anchors commitments on NEAR. The publisher signs with a function-call access key of the
// contract account, limited to `anchor` and `publish_policy` with no deposit, so a leaked key
// can only add hashes. The contract is idempotent per batch id, so a crash after submitting is
// recovered by checking the chain and resending the same frozen batch.
@Injectable()
export class NearPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NearPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly near: NearService,
  ) {}

  configured() {
    return !!(
      this.near.enabled() &&
      this.near.contractId() &&
      this.config.get('NEAR_PUBLISHER_KEY')
    );
  }

  onModuleInit() {
    if (!this.configured()) {
      if (this.near.enabled())
        this.logger.warn(
          'NEAR anchoring is off: set NEAR_CONTRACT_ID and NEAR_PUBLISHER_KEY. Commitments are still recorded.',
        );
      return;
    }
    const interval = Number(
      this.config.get('NEAR_ANCHOR_INTERVAL_MS') ?? 30_000,
    );
    this.timer = setInterval(() => void this.tick(), Math.max(5_000, interval));
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private account() {
    const provider = new JsonRpcProvider({ url: this.near.rpcUrl() });
    // The publisher key belongs to the contract account itself, so predecessor == contract.
    return new Account(
      this.near.contractId(),
      provider,
      this.config.getOrThrow<string>('NEAR_PUBLISHER_KEY') as KeyPairString,
    );
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishPolicy();
      await this.freeze();
      await this.submit();
    } catch (error) {
      this.logger.warn(
        `NEAR publisher tick failed: ${error instanceof Error ? error.message.slice(0, 200) : 'error'}`,
      );
    } finally {
      this.running = false;
    }
  }

  async publishPolicy() {
    const version = GATE_RULES.version;
    const row = await this.prisma.nearPolicy.upsert({
      where: { version },
      create: {
        version,
        hash: GATE_HASH,
        rules: JSON.parse(JSON.stringify(GATE_RULES)) as Prisma.InputJsonValue,
      },
      update: {},
    });
    if (row.hash !== GATE_HASH)
      throw new Error(`Tomo gate v${version} changed without a version bump.`);
    if (row.publishedAt) return;
    const contract = this.near.contractId();
    const onChain = await viewPolicy(this.near.rpcUrl(), contract, version);
    let transaction = row.transaction;
    if (!onChain) {
      const outcome = await this.account().callFunctionRaw({
        contractId: contract,
        methodName: 'publish_policy',
        args: { version, hash: GATE_HASH },
        gas: teraToGas('30'),
        waitUntil: 'FINAL',
      });
      transaction = outcome.transaction.hash;
    } else if (onChain.hash !== GATE_HASH) {
      throw new Error(
        `NEAR already holds a different hash for Tomo gate v${version}.`,
      );
    }
    await this.prisma.nearPolicy.update({
      where: { version },
      data: { transaction, publishedAt: new Date() },
    });
    this.logger.log(`Tomo gate v${version} published on NEAR.`);
  }

  async freeze() {
    // ponytail: one API instance runs the publisher; use a row lock before running replicas.
    const pending = await this.prisma.nearEvent.findMany({
      where: { batchId: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_LEAVES,
      select: { id: true, digest: true },
    });
    if (!pending.length) return;
    const leaves = pending.map((event) => eventLeaf(event.digest));
    await this.prisma.$transaction(async (database) => {
      const batch = await database.nearBatch.create({
        data: {
          root: merkleRoot(leaves),
          leaves,
          publisher: this.near.contractId(),
          contract: this.near.contractId(),
          network: this.near.network(),
        },
      });
      for (const [index, event] of pending.entries()) {
        const updated = await database.nearEvent.updateMany({
          where: { id: event.id, batchId: null },
          data: { batchId: batch.id, leafIndex: index },
        });
        if (updated.count !== 1)
          throw new Error('Commitment was batched concurrently.');
      }
    });
  }

  async submit() {
    const batches = await this.prisma.nearBatch.findMany({
      where: { status: { in: ['FROZEN', 'SUBMITTED'] } },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    for (const batch of batches) {
      const count = (batch.leaves as string[]).length;
      const onChain = await viewBatch(
        this.near.rpcUrl(),
        batch.contract,
        batch.id,
      );
      if (onChain) {
        if (onChain.root !== batch.root || onChain.count !== count) {
          await this.prisma.nearBatch.update({
            where: { id: batch.id },
            data: {
              status: 'CONFLICT',
              error: 'On-chain root differs from the frozen batch.',
            },
          });
          this.logger.error(`Batch ${batch.id} conflicts with NEAR state.`);
          continue;
        }
        await this.prisma.nearBatch.update({
          where: { id: batch.id },
          data: {
            status: 'ANCHORED',
            anchoredAt: new Date(
              Number(BigInt(onChain.timestamp_ns) / 1_000_000n),
            ),
          },
        });
        continue;
      }
      try {
        const outcome = await this.account().callFunctionRaw({
          contractId: batch.contract,
          methodName: 'anchor',
          args: { batch_id: batch.id, root: batch.root, count },
          gas: teraToGas('30'),
          waitUntil: 'FINAL',
        });
        await this.prisma.nearBatch.update({
          where: { id: batch.id },
          data: {
            status: 'SUBMITTED',
            transaction: outcome.transaction.hash,
            submittedAt: new Date(),
            error: null,
          },
        });
        // The next tick confirms the root with a final-state view before marking it anchored.
      } catch (error) {
        await this.prisma.nearBatch.update({
          where: { id: batch.id },
          data: {
            error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : 'submit failed',
          },
        });
        throw error;
      }
    }
  }
}
