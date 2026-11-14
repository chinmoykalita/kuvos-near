import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import {
  type PhysioSelection,
  checkReviewMembership,
  reviewPhysio,
} from './physio-review';
import { physioCatalogue } from './physio-catalogue';
import { WorkflowService } from './workflow.service';
import type { PrismaService } from './database/prisma.service';
import type { DocumentStorageService } from './document-storage.service';
import type { NearService } from './near/near.service';

const library = JSON.parse(
  readFileSync('../../packages/mobile-core/src/physio/library.json', 'utf8'),
) as typeof physioCatalogue;
assert.deepEqual(physioCatalogue, {
  version: library.version,
  exercises: library.exercises.map(
    ({ id, name, form, precautions, supports }) => ({
      id,
      name,
      form,
      precautions,
      supports,
    }),
  ),
});
assert.throws(() =>
  reviewPhysio({ exercise_id: 'fake', dosage: '10 reps' }, 'reviewer', true),
);
assert.throws(() =>
  reviewPhysio({ exercise_id: 'knee-quad-set' }, 'reviewer', true),
);
const chosen = reviewPhysio(
  {
    exercise_id: 'knee-quad-set',
    dosage: '5 repetitions',
    selected_by: 'forged',
    origin: 'document_match',
  },
  'reviewer',
  true,
)!;
assert.equal(chosen.selected_by, 'reviewer');
assert.equal(chosen.origin, 'reviewer_added');
assert.throws(() =>
  checkReviewMembership(
    [{ candidate_id: 'library:knee-quad-set' }],
    ['original'],
  ),
);
assert.throws(() =>
  checkReviewMembership(
    [{ candidate_id: 'original' }, { candidate_id: 'original' }],
    ['original'],
  ),
);
assert.throws(() => checkReviewMembership([{ candidate_id: 'made-up' }], []));

async function check() {
  const original = {
    candidate_id: 'original',
    category: 'exercise',
    instruction_text: 'Heel slides, 5 repetitions',
    action_text: 'Heel slides',
    fields: [{ name: 'reps', raw_value: '5' }],
    evidence_span_ids: ['span-1'],
    schedule: { kind: 'times_per_day', times: ['10:00'], duration_days: 2 },
  };
  const immutable = structuredClone(original);
  type SavedCandidate = typeof original & { physio: PhysioSelection };
  type Plan = { id: string; name: string; status: string };
  const extraction = {
    id: 'extraction',
    status: 'REVIEW_READY',
    document: { patientId: 'patient' },
    result: { evaluation: { candidates: [original] } },
    review: null as { candidates: SavedCandidate[] } | null,
    planId: null as string | null,
    plan: null as Plan | null,
  };
  const items: { id: string; physio: PhysioSelection }[] = [];
  const occurrences: unknown[] = [];
  const database = {
    $transaction: async <T>(
      callback: (db: unknown) => Promise<T>,
    ): Promise<T> => callback(database),
    extraction: {
      findFirst: ({
        where,
      }: {
        where: {
          document: {
            patient: {
              memberships: { some: { userId: string; revokedAt: null } };
            };
          };
        };
      }) => {
        assert.equal(where.document.patient.memberships.some.revokedAt, null);
        return Promise.resolve(
          where.document.patient.memberships.some.userId === 'reviewer'
            ? extraction
            : null,
        );
      },
      update: ({ data }: { data: Partial<typeof extraction> }) => {
        Object.assign(extraction, data);
        return Promise.resolve(extraction);
      },
    },
    patientProfile: {
      findUniqueOrThrow: () => Promise.resolve({ timezone: 'Asia/Kolkata' }),
    },
    plan: {
      create: ({ data }: { data: { name: string } }) => {
        extraction.plan = { id: 'plan', ...data, status: 'ACTIVE' };
        return Promise.resolve(extraction.plan);
      },
    },
    planItem: {
      create: ({ data }: { data: { physio: PhysioSelection } }) => {
        const item = { id: `item-${items.length}`, ...data };
        items.push(item);
        return Promise.resolve(item);
      },
    },
    occurrence: {
      createMany: ({ data }: { data: unknown[] }) => {
        occurrences.push(...data);
        return Promise.resolve({ count: data.length });
      },
    },
    auditEvent: { create: () => Promise.resolve({}) },
  };
  const service = new WorkflowService(
    database as unknown as PrismaService,
    new ConfigService(),
    {} as DocumentStorageService,
    { planVersion: () => Promise.resolve(null) } as unknown as NearService,
  );
  const added = {
    ...structuredClone(original),
    candidate_id: 'library:knee-quad-set',
    instruction_text: 'forged',
    evidence_span_ids: ['forged-span'],
    physio: { exercise_id: 'knee-quad-set', dosage: '5 repetitions' },
    decision: 'accepted',
  };
  const review = {
    candidates: [
      {
        ...structuredClone(original),
        physio: { exercise_id: 'knee-heel-slide' },
        decision: 'accepted',
      },
      added,
    ],
  };
  await assert.rejects(service.saveReview('outsider', extraction.id, review));
  await assert.rejects(
    service.saveReview('reviewer', extraction.id, { candidates: [added] }),
  );
  await assert.rejects(
    service.saveReview('reviewer', extraction.id, {
      candidates: [
        review.candidates[0],
        { ...added, physio: { exercise_id: 'fake', dosage: '5 reps' } },
      ],
    }),
  );
  await service.saveReview('reviewer', extraction.id, structuredClone(review));
  assert.deepEqual(original, immutable);
  const saved = extraction.review!.candidates;
  assert.equal(saved[0].physio.origin, 'document_match');
  assert.deepEqual(saved[0].evidence_span_ids, ['span-1']);
  assert.deepEqual(saved[1].evidence_span_ids, []);
  assert.equal(saved[1].physio.selected_by, 'reviewer');
  assert(saved[1].instruction_text.includes('5 repetitions'));
  assert(!saved[1].instruction_text.includes('forged'));
  await service.saveReview(
    'reviewer',
    extraction.id,
    structuredClone(extraction.review),
  );
  const confirmed = await service.confirm('reviewer', extraction.id, {
    name: 'Exercise plan',
  });
  assert.equal(items.length, 2);
  assert.equal(items[1].physio.origin, 'reviewer_added');
  assert.equal(occurrences.length, 4);
  assert.equal(
    (await service.confirm('reviewer', extraction.id, {})).planId,
    confirmed.planId,
  );
  assert.equal(items.length, 2);
  console.log(
    'Physio validation, provenance, access, save/preview/confirm, scheduling and retry passed.',
  );
}
void check();
