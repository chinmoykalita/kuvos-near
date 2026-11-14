import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { CareService } from './care.service';
import type { PrismaService } from './database/prisma.service';
import type { DocumentStorageService } from './document-storage.service';

async function check() {
  let allowed = true;
  let readOccurrences = false;
  const now = new Date();
  const prisma = {
    careMembership: {
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.userId, 'actor');
        assert.equal(where.patientId, 'patient');
        assert.equal(where.revokedAt, null);
        return Promise.resolve(allowed ? { userId: 'actor' } : null);
      },
    },
    patientProfile: {
      findUniqueOrThrow: () => Promise.resolve({ timezone: 'Asia/Kolkata' }),
    },
    occurrence: {
      findMany: ({
        where,
      }: {
        where: { planItem: { plan: { patientId: string } } };
      }) => {
        assert.equal(where.planItem.plan.patientId, 'patient');
        readOccurrences = true;
        return Promise.resolve([
          { scheduledAt: now, status: 'DONE' },
          { scheduledAt: now, status: 'SKIPPED' },
          { scheduledAt: now, status: 'MISSED' },
        ]);
      },
    },
  };
  // The ordinary care endpoint must work without any Solana configuration.
  const care = new CareService(
    prisma as unknown as PrismaService,
    new ConfigService(),
    {} as DocumentStorageService,
  );
  const rhythm = await care.rhythm('actor', 'patient');
  assert.equal(rhythm.timezone, 'Asia/Kolkata');
  assert.equal(rhythm.days.length, 28);
  assert.equal(rhythm.recordedDays, 1);
  assert.equal(rhythm.days.at(-1)?.done, 1);
  assert.equal(rhythm.days.at(-1)?.skipped, 1);
  assert.equal(rhythm.days.at(-1)?.missed, 1);
  allowed = false;
  readOccurrences = false;
  await assert.rejects(
    () => care.rhythm('actor', 'patient'),
    /Patient not found/,
  );
  assert.equal(readOccurrences, false);
  console.log('Rhythm checks passed.');
}
void check();
