import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConfigService } from '@nestjs/config';
import { AI_PROCESSING_CONSENT_VERSION } from './care.utils';
import { PrismaService } from './database/prisma.service';
import { DocumentStorageService } from './document-storage.service';
import { WorkflowService } from './workflow.service';
import { NearService } from './near/near.service';
import { ExtractionStatus } from './generated/prisma/client';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

async function check() {
  const config = new ConfigService({
    DOCUMENTS_BUCKET: 'synthetic-bucket',
    AWS_REGION: 'us-east-2',
  });
  const storage = new DocumentStorageService(config);
  storage.client.config.credentials = () =>
    Promise.resolve({
      accessKeyId: 'synthetic',
      secretAccessKey: 'synthetic',
    });
  const original = Buffer.from('%PDF-synthetic-document');
  const path =
    's3://synthetic-bucket/documents/00000000-0000-4000-8000-000000000001/original.pdf';
  const signed = await storage.signUpload(
    path,
    original.length,
    'application/pdf',
    createHash('md5').update(original).digest('hex'),
  );
  const url = new URL(signed.url);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  for (const header of [
    'content-length',
    'content-md5',
    'content-type',
    'if-none-match',
  ]) {
    assert(
      url.searchParams.get('X-Amz-SignedHeaders')?.split(';').includes(header),
    );
  }
  assert.equal(signed.headers['If-None-Match'], '*');
  assert.equal(
    signed.headers['Content-MD5'],
    createHash('md5').update(original).digest('base64'),
  );
  assert.throws(() =>
    storage.location(path.replace('synthetic-bucket', 'other-bucket')),
  );
  assert.throws(() => storage.location(`${path}/../other-document`));

  let bytes = original;
  const commands: unknown[] = [];
  storage.client.send = ((command: unknown) => {
    commands.push(command);
    if (command instanceof HeadObjectCommand)
      return Promise.resolve({
        ContentLength: bytes.length,
        ContentType: 'application/pdf',
      });
    if (command instanceof GetObjectCommand)
      return Promise.resolve({
        Body: { transformToByteArray: () => Promise.resolve(bytes) },
      });
    throw new Error('Unexpected storage request');
  }) as typeof storage.client.send;
  await storage.verifyUpload(path, original.length, 'application/pdf', '.pdf');
  assert.equal((commands[1] as GetObjectCommand).input.Range, 'bytes=0-15');
  await assert.rejects(
    storage.verifyUpload(path, original.length + 1, 'application/pdf', '.pdf'),
  );
  bytes = Buffer.alloc(original.length);
  await assert.rejects(
    storage.verifyUpload(path, original.length, 'application/pdf', '.pdf'),
  );
  bytes = original;
  storage.client.send = (() =>
    Promise.resolve({
      Body: Readable.from(original),
    })) as typeof storage.client.send;
  assert(await storage.page(path));
  let deleted = false;
  storage.client.send = ((command: unknown) => {
    if (command instanceof ListObjectsV2Command) {
      assert.equal(
        command.input.Prefix,
        'documents/00000000-0000-4000-8000-000000000001/',
      );
      return Promise.resolve({
        Contents: [
          {
            Key: 'documents/00000000-0000-4000-8000-000000000001/original.pdf',
          },
        ],
      });
    }
    assert(command instanceof DeleteObjectsCommand);
    deleted = true;
    return Promise.resolve({});
  }) as typeof storage.client.send;
  await storage.removeDocument(path);
  assert(deleted);

  let member = true;
  let consent = true;
  let verified = false;
  let queues = 0;
  let audits = 0;
  type Draft = {
    id: string;
    patientId: string;
    uploadedById: string;
    path: string;
    fileName: string;
    size: number;
    mimeType: string;
    extractions: { create: { status: ExtractionStatus; planId?: string } };
  };
  let document!: Omit<Draft, 'extractions'> & {
    extractions: {
      id: string;
      status: ExtractionStatus;
      planId: string | null;
    }[];
  };
  const database = {
    careMembership: {
      findFirst: () => Promise.resolve(member ? { id: 'membership' } : null),
    },
    user: {
      findUnique: () =>
        Promise.resolve({
          aiProcessingConsentVersion: consent
            ? AI_PROCESSING_CONSENT_VERSION
            : null,
        }),
    },
    plan: {
      findFirst: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'active-plan' ? { id: where.id } : null),
    },
    document: {
      create: ({ data }: { data: Draft }) => {
        assert.equal(
          data.extractions.create.planId,
          undefined,
          'Uploads must not attach to a live plan before human confirmation',
        );
        document = {
          ...data,
          extractions: [
            {
              id: 'extraction',
              status: data.extractions.create.status,
              planId: null,
            },
          ],
        };
        return Promise.resolve(document);
      },
      findFirst: ({ where }: { where: { uploadedById: string } }) =>
        Promise.resolve(
          where.uploadedById === document.uploadedById ? document : null,
        ),
    },
    extraction: {
      findFirst: ({
        where,
      }: {
        where: {
          document: { patient: { memberships: { some: { userId: string } } } };
        };
      }) =>
        Promise.resolve(
          member &&
            where.document.patient.memberships.some.userId === 'uploader'
            ? {
                id: 'extraction',
                status: 'FAILED',
                error: 'private S3 path with document identifier',
                runDir:
                  's3://synthetic-bucket/documents/00000000-0000-4000-8000-000000000001/runs/extraction',
                document,
                planId: null,
                review: null,
                result: {
                  document: {
                    pages: [{ page: 1, image_path: 'pages/page-0001.png' }],
                  },
                },
              }
            : null,
        ),
      updateMany: () => {
        assert(
          verified,
          'Extraction must not queue until object verification succeeds',
        );
        queues++;
        document.extractions[0].status = ExtractionStatus.QUEUED;
        return Promise.resolve({ count: 1 });
      },
    },
    auditEvent: {
      create: () => {
        audits++;
        return Promise.resolve({});
      },
    },
    $transaction: (callback: (db: unknown) => unknown) => callback(database),
  };
  const workflow = new WorkflowService(
    database as unknown as PrismaService,
    config,
    storage,
    {
      activity: () => Promise.resolve(null),
      planVersion: () => Promise.resolve(null),
    } as unknown as NearService,
  );
  const body = {
    patientId: 'patient',
    planId: 'active-plan',
    fileName: 'care.pdf',
    size: original.length,
    md5: createHash('md5').update(original).digest('hex'),
  };
  await workflow.upload('uploader', body);
  assert.equal(document.extractions[0].status, 'UPLOADING');
  assert.equal(queues, 0);
  storage.verifyUpload = () =>
    Promise.reject(new Error('synthetic storage failure'));
  await assert.rejects(workflow.completeUpload('uploader', document.id));
  assert.equal(queues, 0);
  storage.verifyUpload = () => {
    verified = true;
    return Promise.resolve();
  };
  await assert.rejects(workflow.completeUpload('other-user', document.id));
  member = false;
  await assert.rejects(workflow.completeUpload('uploader', document.id));
  member = true;
  consent = false;
  await assert.rejects(workflow.completeUpload('uploader', document.id));
  consent = true;
  await workflow.completeUpload('uploader', document.id);
  await workflow.completeUpload('uploader', document.id);
  assert.equal(queues, 1);
  assert.equal(audits, 1);
  for (const invalid of [
    { size: 50_000_001 },
    { md5: 'invalid' },
    { fileName: 'care.exe' },
    { planId: 1 },
  ]) {
    await assert.rejects(workflow.upload('uploader', { ...body, ...invalid }));
  }
  assert.equal(
    await workflow.getPagePath('uploader', 'extraction', 1),
    's3://synthetic-bucket/documents/00000000-0000-4000-8000-000000000001/runs/extraction/pages/page-0001.png',
  );
  await assert.rejects(workflow.getPagePath('other-user', 'extraction', 1));
  await assert.rejects(workflow.getPagePath('uploader', 'extraction', 2));
  const failed = await workflow.getExtraction('uploader', 'extraction');
  assert.equal(
    failed.error,
    'The document could not be processed. Please try uploading it again.',
  );
  storage.client.destroy();
  console.log('signed document upload check passed');
}

void check();
