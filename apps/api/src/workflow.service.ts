import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { basename, extname, resolve, sep } from 'node:path';
import {
  CareRole,
  ExtractionStatus,
  OccurrenceStatus,
  PlanStatus,
  Prisma,
} from './generated/prisma/client';
import { PrismaService } from './database/prisma.service';
import { DocumentStorageService } from './document-storage.service';
import { checkReviewMembership, reviewPhysio } from './physio-review';
import { reviewExplanation } from './explanation';
import { NearService } from './near/near.service';
import {
  AI_PROCESSING_CONSENT_VERSION,
  hasCurrentAiProcessingConsent,
} from './care.utils';
import {
  DEFAULT_MARK_CLOSE_AFTER_MINUTES,
  DEFAULT_MARK_OPEN_BEFORE_MINUTES,
  MAX_SCHEDULE_DAYS,
  dateInZone,
  datesFrom,
  markingBounds,
  markingWindowState,
  parseOccurrenceAction,
  parsePlanName,
  parseScheduleDays,
  scheduleDayCount,
  scheduleNeedsDayCount,
  scheduleStartDate,
  scheduledOccurrences,
  skipReasonOptions,
  suggestedPlanNameFromResult,
  uniqueClockTimes,
  zonedDateTime,
  reviewableResult,
} from './workflow.utils';

type JsonObject = Record<string, unknown>;
type Schedule = JsonObject & {
  kind: string;
  times: string[];
  count?: number;
  duration_days?: number;
  end_date?: string;
  date?: string;
  start_date?: string;
  days_of_week?: unknown;
};
type ReviewCandidate = JsonObject & {
  candidate_id: string;
  category: string;
  instruction_text: string;
  action_text?: string;
  fields: unknown[];
  evidence_span_ids: string[];
  decision?: 'accepted' | 'rejected';
  schedule: Schedule;
};

const supportedExtensions = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.tif',
  '.tiff',
]);
const supportedScheduleKinds = new Set([
  'unknown',
  'exact_times',
  'times_per_day',
  'interval',
  'weekly',
  'once',
  'as_needed',
  'persistent',
]);

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

@Injectable()
export class WorkflowService {
  private readonly timezone: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly storage: DocumentStorageService,
    private readonly near: NearService,
  ) {
    this.timezone = config.get('DEFAULT_TIMEZONE', 'Asia/Kolkata');
    new Intl.DateTimeFormat('en', { timeZone: this.timezone });
  }

  private async requireUploadAccess(
    userId: string,
    patientId: string,
    planId?: string,
  ) {
    await this.requireMembership(userId, patientId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { aiProcessingConsentVersion: true },
    });
    if (!hasCurrentAiProcessingConsent(user?.aiProcessingConsentVersion)) {
      throw new BadRequestException(
        'AI processing consent is required before upload.',
      );
    }
    if (planId) {
      const plan = await this.prisma.plan.findFirst({
        where: { id: planId, patientId, status: PlanStatus.ACTIVE },
        select: { id: true },
      });
      if (!plan) throw new NotFoundException('Plan not found.');
    }
  }

  async upload(userId: string, value: unknown) {
    const body = object(value);
    if (typeof body.patientId !== 'string' || !body.patientId) {
      throw new BadRequestException('A patient is required.');
    }
    if (
      body.planId !== undefined &&
      (typeof body.planId !== 'string' || !body.planId)
    ) {
      throw new BadRequestException('Invalid plan.');
    }
    const planId = body.planId;
    await this.requireUploadAccess(userId, body.patientId, planId);
    if (
      typeof body.fileName !== 'string' ||
      !body.fileName.trim() ||
      body.fileName.length > 255
    ) {
      throw new BadRequestException('A document filename is required.');
    }
    const extension = extname(body.fileName).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      throw new BadRequestException(
        'Supported files: PDF, JPG, PNG, and TIFF.',
      );
    }
    if (
      typeof body.size !== 'number' ||
      !Number.isInteger(body.size) ||
      body.size < 1 ||
      body.size > 50_000_000
    ) {
      throw new BadRequestException(
        'Documents must be between 1 byte and 50 MB.',
      );
    }
    if (typeof body.md5 !== 'string' || !/^[a-f0-9]{32}$/i.test(body.md5)) {
      throw new BadRequestException('A document checksum is required.');
    }
    const mimeType =
      extension === '.pdf'
        ? 'application/pdf'
        : extension === '.png'
          ? 'image/png'
          : ['.tif', '.tiff'].includes(extension)
            ? 'image/tiff'
            : 'image/jpeg';
    const documentId = randomUUID();
    const path = `s3://${this.storage.bucket}/documents/${documentId}/original${extension}`;
    const upload = await this.storage.signUpload(
      path,
      body.size,
      mimeType,
      body.md5,
    );
    // ponytail: retain abandoned uploads for account cleanup; add expiry cleanup when volume requires it.
    const document = await this.prisma.document.create({
      data: {
        id: documentId,
        patientId: body.patientId,
        uploadedById: userId,
        fileName: basename(body.fileName),
        path,
        mimeType,
        size: body.size,
        extractions: { create: { status: ExtractionStatus.UPLOADING } },
      },
      include: { extractions: true },
    });
    return { documentId: document.id, upload, expiresIn: 300 };
  }

  async completeUpload(
    userId: string,
    documentId: string,
    value: unknown = {},
  ) {
    const body = object(value);
    if (
      body.planId !== undefined &&
      (typeof body.planId !== 'string' || !body.planId)
    ) {
      throw new BadRequestException('Invalid plan.');
    }
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, uploadedById: userId },
      include: { extractions: true },
    });
    const extraction = document?.extractions[0];
    if (!document?.patientId || !extraction)
      throw new NotFoundException('Document not found.');
    const planId = body.planId;
    await this.requireUploadAccess(userId, document.patientId, planId);
    if (extraction.status === ExtractionStatus.UPLOADING) {
      await this.storage.verifyUpload(
        document.path,
        document.size,
        document.mimeType,
        extname(document.fileName).toLowerCase(),
      );
      await this.prisma.$transaction(async (database) => {
        const queued = await database.extraction.updateMany({
          where: { id: extraction.id, status: ExtractionStatus.UPLOADING },
          data: { status: ExtractionStatus.QUEUED },
        });
        if (queued.count) {
          await database.auditEvent.create({
            data: {
              actorUserId: userId,
              patientId: document.patientId!,
              action: 'document.uploaded',
              metadata: {
                ...(planId ? { planId } : {}),
                processingConsent: true,
                syntheticTestData: true,
                consentVersion: AI_PROCESSING_CONSENT_VERSION,
              },
            },
          });
        }
      });
    }
    return {
      documentId: document.id,
      extractionId: extraction.id,
      status:
        extraction.status === ExtractionStatus.UPLOADING
          ? 'queued'
          : extraction.status.toLowerCase(),
      ...(planId ? { planId } : {}),
    };
  }

  async getExtraction(userId: string, id: string) {
    const extraction = await this.prisma.extraction.findFirst({
      where: {
        id,
        document: {
          patient: { memberships: { some: { userId, revokedAt: null } } },
        },
      },
      include: { document: true },
    });
    if (!extraction) throw new NotFoundException('Extraction not found.');
    return {
      id: extraction.id,
      status: extraction.status.toLowerCase(),
      error: extraction.error
        ? 'The document could not be processed. Please try uploading it again.'
        : null,
      document: {
        id: extraction.document.id,
        fileName: extraction.document.fileName,
      },
      planId: extraction.planId || undefined,
      suggestedPlanName: suggestedPlanNameFromResult(extraction.result),
      result: reviewableResult(extraction.result),
      review: extraction.review,
    };
  }

  async getPagePath(
    userId: string,
    id: string,
    pageNumber: number,
  ): Promise<string> {
    const extraction = await this.prisma.extraction.findFirst({
      where: {
        id,
        document: {
          patient: { memberships: { some: { userId, revokedAt: null } } },
        },
      },
    });
    if (!extraction?.runDir || !extraction.result) {
      throw new NotFoundException('Extraction page not found.');
    }
    const result = object(extraction.result);
    const document = object(result.document);
    const pages = Array.isArray(document.pages) ? document.pages : [];
    const page = pages.map(object).find((item) => item.page === pageNumber);
    if (typeof page?.image_path !== 'string') {
      throw new NotFoundException('Extraction page not found.');
    }
    if (extraction.runDir.startsWith('s3://')) {
      if (!/^pages\/page-[0-9]{4,}\.png$/.test(page.image_path)) {
        throw new BadRequestException('Invalid page path.');
      }
      return `${extraction.runDir}/${page.image_path}`;
    }
    const runDir = resolve(extraction.runDir);
    const path = resolve(runDir, page.image_path);
    if (!path.startsWith(`${runDir}${sep}`)) {
      throw new BadRequestException('Invalid page path.');
    }
    return path;
  }

  async saveReview(userId: string, id: string, body: unknown) {
    const extraction = await this.prisma.extraction.findFirst({
      where: {
        id,
        document: {
          patient: { memberships: { some: { userId, revokedAt: null } } },
        },
      },
      include: { document: true },
    });
    if (!extraction) throw new NotFoundException('Extraction not found.');
    if (extraction.status !== ExtractionStatus.REVIEW_READY) {
      throw new ConflictException('Extraction is not ready for review.');
    }
    const review = object(body);
    const candidates = this.reviewCandidates(review);
    const result = object(extraction.result);
    const evaluation = object(result.evaluation);
    const originals = Array.isArray(evaluation.candidates)
      ? evaluation.candidates.map(object)
      : [];
    const originalById = new Map(
      originals.map((candidate) => [candidate.candidate_id, candidate]),
    );
    checkReviewMembership(
      candidates,
      originals.map((candidate) => String(candidate.candidate_id)),
    );
    for (const candidate of candidates) {
      const original = originalById.get(candidate.candidate_id);
      const added = !original;
      const physio = reviewPhysio(candidate.physio, userId, added);
      candidate.physio = physio ?? null;
      if (added) {
        if (
          !physio ||
          candidate.candidate_id !== `library:${physio.exercise_id}`
        )
          throw new BadRequestException('Invalid added exercise ID.');
        if (candidate.schedule.kind !== 'times_per_day')
          throw new BadRequestException(
            'Added exercises require daily reminder times.',
          );
        if (
          candidate.decision !== 'rejected' &&
          (!Number.isInteger(candidate.schedule.duration_days) ||
            Number(candidate.schedule.duration_days) < 1 ||
            Number(candidate.schedule.duration_days) > MAX_SCHEDULE_DAYS)
        )
          throw new BadRequestException(
            'Choose between 1 and 366 days for the exercise.',
          );
        candidate.category = 'exercise';
        candidate.instruction_text = `${physio.instruction_snapshot}\nYour instructions: ${physio.dosage}`;
        candidate.action_text = `${physio.instruction_snapshot.split('\n')[0]} — ${physio.dosage}`;
        candidate.fields = [
          { name: 'exercise_dosage', raw_value: physio.dosage },
        ];
        candidate.evidence_span_ids = [];
        candidate.explanation = undefined;
        candidate.review_status = 'reviewer_added';
        candidate.schedule = {
          kind: 'times_per_day',
          times: candidate.schedule.times,
          duration_days: candidate.schedule.duration_days,
        };
        if (candidate.decision !== 'rejected')
          this.validateSchedule(
            candidate,
            dateInZone(new Date(), this.timezone),
          );
        continue;
      }
      if (
        physio &&
        (original.category === 'restriction' ||
          !/exercise|physio/i.test(
            String(original.category) + ' ' + String(original.instruction_text),
          ))
      ) {
        throw new BadRequestException(
          'Only exercise instructions can have a demonstration.',
        );
      }

      candidate.explanation = reviewExplanation(
        candidate.explanation,
        original.explanation,
      );
      candidate.category = String(original.category);
      candidate.fields = Array.isArray(original.fields) ? original.fields : [];
      candidate.evidence_span_ids = Array.isArray(original.evidence_span_ids)
        ? original.evidence_span_ids.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const originalSchedule = object(original.schedule);
      const submittedDays = Number(candidate.schedule.duration_days);
      const durationDays =
        Number.isInteger(submittedDays) && submittedDays >= 0
          ? submittedDays
          : parseScheduleDays(originalSchedule.duration_days);
      candidate.schedule = {
        ...originalSchedule,
        kind: candidate.schedule.kind,
        times: candidate.schedule.times,
        duration_days: durationDays,
        end_date:
          durationDays > 0
            ? ''
            : typeof originalSchedule.end_date === 'string'
              ? originalSchedule.end_date
              : '',
        needs_user_input:
          !['as_needed', 'persistent'].includes(candidate.schedule.kind) &&
          candidate.schedule.times.length === 0,
      };
    }
    review.candidates = candidates;
    const saved = await this.prisma.$transaction(async (database) => {
      const updated = await database.extraction.update({
        where: { id },
        data: { review: review as Prisma.InputJsonValue },
      });
      if (extraction.document.patientId) {
        await database.auditEvent.create({
          data: {
            actorUserId: userId,
            patientId: extraction.document.patientId,
            action: 'extraction.reviewed',
          },
        });
      }
      return updated;
    });
    return { id: saved.id, review: saved.review };
  }

  async confirm(userId: string, id: string, body: unknown = {}) {
    const extraction = await this.prisma.extraction.findFirst({
      where: {
        id,
        document: {
          patient: { memberships: { some: { userId, revokedAt: null } } },
        },
      },
      include: { plan: true, document: true },
    });
    if (!extraction) throw new NotFoundException('Extraction not found.');
    if (extraction.planId && extraction.plan) {
      return {
        planId: extraction.plan.id,
        name: extraction.plan.name,
        status: extraction.plan.status.toLowerCase(),
      };
    }
    if (
      extraction.status !== ExtractionStatus.REVIEW_READY ||
      !extraction.review
    ) {
      throw new ConflictException('Save the completed review first.');
    }
    const patientId = extraction.document.patientId;
    if (!patientId) {
      throw new BadRequestException('A patient is required to confirm a plan.');
    }
    const request = object(body);
    const attachPlanId =
      typeof request.planId === 'string' && request.planId.trim()
        ? request.planId.trim()
        : undefined;
    const suggestedName = suggestedPlanNameFromResult(extraction.result);
    const candidates = this.reviewCandidates(object(extraction.review), true);
    const accepted = candidates.filter(
      (candidate) => candidate.decision === 'accepted',
    );
    if (!accepted.length) {
      throw new BadRequestException('Accept at least one instruction.');
    }

    const planTimezone = (
      await this.prisma.patientProfile.findUniqueOrThrow({
        where: { id: patientId },
        select: { timezone: true },
      })
    ).timezone;
    const today = dateInZone(new Date(), planTimezone);
    accepted.forEach((candidate) => this.validateSchedule(candidate, today));

    const plan = await this.prisma.$transaction(async (database) => {
      let target: { id: string; name: string; status: PlanStatus } | undefined;
      if (attachPlanId) {
        const existing = await database.plan.findFirst({
          where: {
            id: attachPlanId,
            patientId,
            status: PlanStatus.ACTIVE,
          },
          select: { id: true, name: true, status: true },
        });
        if (!existing) throw new NotFoundException('Plan not found.');
        target = existing;
      } else {
        const name = parsePlanName(request.name ?? suggestedName);
        target = await database.plan.create({
          data: {
            patientId,
            name,
            suggestedName,
            confirmedById: userId,
            timezone: planTimezone,
          },
          select: { id: true, name: true, status: true },
        });
      }

      for (const candidate of accepted) {
        const item = await database.planItem.create({
          data: {
            planId: target.id,
            extractionId: id,
            candidateId: candidate.candidate_id,
            category: candidate.category,
            instructionText: candidate.instruction_text,
            actionText:
              candidate.action_text?.trim() || candidate.instruction_text,
            explanation: candidate.explanation as
              Prisma.InputJsonValue | undefined,
            fields: candidate.fields as Prisma.InputJsonValue,
            schedule: candidate.schedule as Prisma.InputJsonValue,
            evidenceSpanIds: candidate.evidence_span_ids,
            physio: candidate.physio
              ? (candidate.physio as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
        const occurrences = scheduledOccurrences(
          candidate,
          today,
          planTimezone,
        ).map((scheduledAt) => ({ planItemId: item.id, scheduledAt }));
        if (occurrences.length) {
          await database.occurrence.createMany({ data: occurrences });
        }
      }
      await database.extraction.update({
        where: { id },
        data: {
          status: ExtractionStatus.CONFIRMED,
          planId: target.id,
        },
      });
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId,
          action: attachPlanId ? 'plan.attached' : 'plan.confirmed',
          metadata: { planId: target.id, extractionId: id },
        },
      });
      // The confirmed plan is the policy: commit this exact version before activation returns.
      await this.near.planVersion(
        database,
        target.id,
        userId,
        attachPlanId ? 'attached' : 'confirmed',
      );
      return target;
    });
    return {
      planId: plan.id,
      name: plan.name,
      status: plan.status.toLowerCase(),
    };
  }

  async listPlans(userId: string, patientId: string) {
    await this.requireMembership(userId, patientId);
    const patient = await this.prisma.patientProfile.findUniqueOrThrow({
      where: { id: patientId },
      select: {
        timezone: true,
        markOpenBeforeMinutes: true,
        markCloseAfterMinutes: true,
      },
    });
    const plans = await this.prisma.plan.findMany({
      where: { patientId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        suggestedName: true,
        status: true,
        timezone: true,
        createdAt: true,
        closedAt: true,
      },
    });
    const now = new Date();
    const date = dateInZone(now, patient.timezone);
    const start = zonedDateTime(date, '00:00', patient.timezone);
    const end = zonedDateTime(datesFrom(date, 2)[1], '00:00', patient.timezone);
    const adherence = await Promise.all(
      plans.map(async (plan) => {
        if (plan.status !== PlanStatus.ACTIVE) {
          return {
            ...plan,
            status: plan.status.toLowerCase(),
            adherence: {
              done: 0,
              skipped: 0,
              missed: 0,
              remaining: 0,
              total: 0,
            },
          };
        }
        const occurrences = await this.prisma.occurrence.findMany({
          where: {
            planItem: { planId: plan.id },
            OR: [
              { scheduledAt: { gte: start, lt: end } },
              {
                status: OccurrenceStatus.SCHEDULED,
                scheduledAt: {
                  gte: new Date(
                    start.getTime() - patient.markCloseAfterMinutes * 60_000,
                  ),
                  lt: start,
                },
              },
            ],
          },
          select: { id: true, status: true, scheduledAt: true },
        });
        const missedIds = await this.closeExpiredWindows(
          this.prisma,
          occurrences,
          patient.markOpenBeforeMinutes,
          patient.markCloseAfterMinutes,
          now,
        );
        let done = 0;
        let skipped = 0;
        let missed = 0;
        let remaining = 0;
        for (const occurrence of occurrences) {
          if (missedIds.has(occurrence.id)) {
            missed += 1;
            continue;
          }
          if (occurrence.status === OccurrenceStatus.DONE) done += 1;
          else if (occurrence.status === OccurrenceStatus.SKIPPED) skipped += 1;
          else if (occurrence.status === OccurrenceStatus.MISSED) missed += 1;
          else remaining += 1;
        }
        return {
          ...plan,
          status: plan.status.toLowerCase(),
          adherence: {
            done,
            skipped,
            missed,
            remaining,
            total: occurrences.length,
          },
        };
      }),
    );
    return { patientId, date, timezone: patient.timezone, plans: adherence };
  }

  async renamePlan(userId: string, id: string, body: unknown) {
    const plan = await this.planForMember(userId, id);
    const name = parsePlanName(object(body).name);
    const updated = await this.prisma.$transaction(async (database) => {
      const next = await database.plan.update({
        where: { id },
        data: { name },
        select: {
          id: true,
          name: true,
          suggestedName: true,
          status: true,
        },
      });
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId: plan.patientId,
          action: 'plan.renamed',
          metadata: { planId: id, name },
        },
      });
      return next;
    });
    return {
      ...updated,
      status: updated.status.toLowerCase(),
    };
  }

  async closePlan(userId: string, id: string) {
    const plan = await this.planForMember(userId, id);
    if (plan.status === PlanStatus.CLOSED) {
      return {
        planId: plan.id,
        name: plan.name,
        status: 'closed',
        closedAt: plan.closedAt,
      };
    }
    const closed = await this.prisma.$transaction(async (database) => {
      const next = await database.plan.update({
        where: { id },
        data: { status: PlanStatus.CLOSED, closedAt: new Date() },
        select: { id: true, name: true, status: true, closedAt: true },
      });
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId: plan.patientId,
          action: 'plan.closed',
          metadata: { planId: id },
        },
      });
      await this.near.planVersion(database, id, userId, 'closed');
      return next;
    });
    return {
      planId: closed.id,
      name: closed.name,
      status: closed.status.toLowerCase(),
      closedAt: closed.closedAt,
    };
  }

  async getPatientToday(
    userId: string,
    patientId: string,
    requestedDate?: string,
  ) {
    await this.requireMembership(userId, patientId);
    const patient = await this.prisma.patientProfile.findFirst({
      where: {
        id: patientId,
        memberships: { some: { userId, revokedAt: null } },
      },
      select: {
        id: true,
        timezone: true,
        markOpenBeforeMinutes: true,
        markCloseAfterMinutes: true,
        memberships: {
          where: { revokedAt: null, role: CareRole.CAREGIVER },
          select: { user: { select: { name: true } } },
        },
        plans: {
          where: { status: PlanStatus.ACTIVE },
          select: { id: true, name: true, timezone: true },
        },
      },
    });
    if (!patient) throw new NotFoundException('Patient not found.');
    return this.buildToday({
      userId,
      patientId: patient.id,
      timezone: patient.timezone,
      openBeforeMinutes: patient.markOpenBeforeMinutes,
      closeAfterMinutes: patient.markCloseAfterMinutes,
      notifyIfMissed: patient.memberships
        .map((membership) => membership.user.name.trim())
        .filter(Boolean),
      planIds: patient.plans.map((plan) => plan.id),
      planNames: Object.fromEntries(
        patient.plans.map((plan) => [plan.id, plan.name]),
      ),
      requestedDate,
    });
  }

  async getPatientNotificationSchedule(userId: string, patientId: string) {
    const patient = await this.prisma.patientProfile.findFirst({
      where: {
        id: patientId,
        memberships: {
          some: { userId, role: CareRole.PATIENT, revokedAt: null },
        },
      },
      select: {
        timezone: true,
        markCloseAfterMinutes: true,
      },
    });
    if (!patient) throw new NotFoundException('Patient not found.');

    const now = new Date();
    // ponytail: 30 occurrences fits the local-notification ceiling; refill whenever the app syncs.
    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: OccurrenceStatus.SCHEDULED,
        scheduledAt: {
          gt: new Date(now.getTime() - patient.markCloseAfterMinutes * 60_000),
        },
        planItem: {
          plan: { patientId, status: PlanStatus.ACTIVE },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 30,
      select: {
        id: true,
        scheduledAt: true,
        planItem: {
          select: {
            actionText: true,
            instructionText: true,
            planId: true,
          },
        },
      },
    });

    return {
      patientId,
      timezone: patient.timezone,
      syncedAt: now.toISOString(),
      occurrences: occurrences.flatMap((occurrence) => {
        const { closesAt } = markingBounds(
          occurrence.scheduledAt,
          0,
          patient.markCloseAfterMinutes,
        );
        return closesAt > now
          ? [
              {
                id: occurrence.id,
                planId: occurrence.planItem.planId,
                date: dateInZone(occurrence.scheduledAt, patient.timezone),
                actionText:
                  occurrence.planItem.actionText ||
                  occurrence.planItem.instructionText,
                scheduledAt: occurrence.scheduledAt.toISOString(),
                closesAt: closesAt.toISOString(),
              },
            ]
          : [];
      }),
    };
  }

  async closeDueOccurrences(now = new Date()) {
    const candidates = await this.prisma.occurrence.findMany({
      where: {
        status: OccurrenceStatus.SCHEDULED,
        scheduledAt: { lt: new Date(now.getTime() - 15 * 60_000) },
        planItem: { plan: { status: PlanStatus.ACTIVE } },
      },
      select: {
        id: true,
        scheduledAt: true,
        status: true,
        planItem: {
          select: {
            plan: {
              select: {
                patient: { select: { markCloseAfterMinutes: true } },
              },
            },
          },
        },
      },
    });
    let closed = 0;
    // ponytail: per-row transactions are enough for pilot volume; batch when misses become measurable.
    for (const occurrence of candidates) {
      const closeAfterMinutes =
        occurrence.planItem.plan.patient.markCloseAfterMinutes;
      const { closesAt } = markingBounds(
        occurrence.scheduledAt,
        0,
        closeAfterMinutes,
      );
      if (now <= closesAt) continue;
      const changed = await this.prisma.$transaction((database) =>
        this.markMissed(database, occurrence.id),
      );
      if (changed) closed += 1;
    }
    return closed;
  }

  async getToday(userId: string, id: string, requestedDate?: string) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        id,
        patient: { memberships: { some: { userId, revokedAt: null } } },
      },
      include: {
        items: true,
        patient: {
          select: {
            id: true,
            timezone: true,
            markOpenBeforeMinutes: true,
            markCloseAfterMinutes: true,
            memberships: {
              where: { revokedAt: null, role: CareRole.CAREGIVER },
              select: { user: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!plan) throw new NotFoundException('Plan not found.');
    return this.buildToday({
      userId,
      patientId: plan.patient.id,
      timezone: plan.timezone,
      openBeforeMinutes: plan.patient.markOpenBeforeMinutes,
      closeAfterMinutes: plan.patient.markCloseAfterMinutes,
      notifyIfMissed: plan.patient.memberships
        .map((membership) => membership.user.name.trim())
        .filter(Boolean),
      planIds: [plan.id],
      planNames: { [plan.id]: plan.name },
      requestedDate,
      singlePlanId: plan.id,
      restrictionItems: plan.items,
    });
  }

  private async buildToday(input: {
    userId: string;
    patientId: string;
    timezone: string;
    openBeforeMinutes: number;
    closeAfterMinutes: number;
    notifyIfMissed: string[];
    planIds: string[];
    planNames: Record<string, string>;
    requestedDate?: string;
    singlePlanId?: string;
    restrictionItems?: {
      id: string;
      category: string;
      actionText: string | null;
      instructionText: string;
      explanation: Prisma.JsonValue;
      evidenceSpanIds: Prisma.JsonValue;
      extractionId: string;
      candidateId: string;
    }[];
  }) {
    const now = new Date();
    const date = input.requestedDate || dateInZone(now, input.timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Date must use YYYY-MM-DD.');
    }
    const start = zonedDateTime(date, '00:00', input.timezone);
    const nextDate = datesFrom(date, 2)[1];
    const end = zonedDateTime(nextDate, '00:00', input.timezone);
    const isLive = date === dateInZone(now, input.timezone);
    const planFilter =
      input.planIds.length > 0
        ? { planId: { in: input.planIds } }
        : { planId: '__none__' };

    const occurrences = input.planIds.length
      ? await this.prisma.occurrence.findMany({
          where: {
            planItem: planFilter,
            OR: [
              { scheduledAt: { gte: start, lt: end } },
              ...(isLive
                ? [
                    {
                      status: OccurrenceStatus.SCHEDULED,
                      scheduledAt: {
                        gte: new Date(
                          start.getTime() - input.closeAfterMinutes * 60_000,
                        ),
                        lt: start,
                      },
                    },
                  ]
                : []),
            ],
          },
          include: {
            planItem: true,
            logs: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                reason: true,
                actor: { select: { name: true } },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
        })
      : [];

    const missedIds = await this.closeExpiredWindows(
      this.prisma,
      occurrences,
      input.openBeforeMinutes,
      input.closeAfterMinutes,
      now,
    );

    const restrictionItems =
      input.restrictionItems ||
      (input.planIds.length
        ? await this.prisma.planItem.findMany({
            where: {
              planId: { in: input.planIds },
              category: 'restriction',
            },
          })
        : []);

    return {
      ...(input.singlePlanId
        ? {
            planId: input.singlePlanId,
            planName: input.planNames[input.singlePlanId],
          }
        : { patientId: input.patientId }),
      date,
      timezone: input.timezone,
      markingWindow: {
        openBeforeMinutes: input.openBeforeMinutes,
        closeAfterMinutes: input.closeAfterMinutes,
      },
      skipReasons: skipReasonOptions,
      careCircle: { notifyIfMissed: input.notifyIfMissed },
      restrictions: restrictionItems
        .filter((item) => item.category === 'restriction')
        .map((item) => ({
          id: item.id,
          actionText: item.actionText || item.instructionText,
          instructionText: item.instructionText,
          explanation: item.explanation,
          evidenceSpanIds: item.evidenceSpanIds,
          extractionId: item.extractionId,
          candidateId: item.candidateId,
        })),
      occurrences: occurrences.map((occurrence) => {
        const { opensAt, closesAt } = markingBounds(
          occurrence.scheduledAt,
          input.openBeforeMinutes,
          input.closeAfterMinutes,
        );
        const missed = missedIds.has(occurrence.id);
        const status = missed ? 'missed' : occurrence.status.toLowerCase();
        const state = missed
          ? 'closed'
          : markingWindowState(now, opensAt, closesAt);
        return {
          id: occurrence.id,
          scheduledAt: occurrence.scheduledAt,
          status,
          actionText:
            occurrence.planItem.actionText ||
            occurrence.planItem.instructionText,
          instructionText: occurrence.planItem.instructionText,
          explanation: occurrence.planItem.explanation,
          category: occurrence.planItem.category,
          evidenceSpanIds: occurrence.planItem.evidenceSpanIds,
          fields: occurrence.planItem.fields,
          physio: occurrence.planItem.physio,
          schedule: occurrence.planItem.schedule,
          extractionId: occurrence.planItem.extractionId,
          candidateId: occurrence.planItem.candidateId,
          planId: occurrence.planItem.planId,
          planName: input.planNames[occurrence.planItem.planId],
          reason: occurrence.logs[0]?.reason,
          loggedBy: occurrence.logs[0]?.actor?.name,
          canLog: state === 'open' && status !== 'missed',
          window: {
            opensAt: opensAt.toISOString(),
            closesAt: closesAt.toISOString(),
            state,
          },
        };
      }),
    };
  }

  private async planForMember(userId: string, id: string) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        id,
        patient: { memberships: { some: { userId, revokedAt: null } } },
      },
      select: {
        id: true,
        name: true,
        patientId: true,
        status: true,
        closedAt: true,
      },
    });
    if (!plan) throw new NotFoundException('Plan not found.');
    return plan;
  }

  async logOccurrence(userId: string, id: string, value: unknown) {
    const { action, reason, note } = parseOccurrenceAction(value);

    return this.prisma.$transaction(async (database) => {
      const occurrence = await database.occurrence.findFirst({
        where: {
          id,
          planItem: {
            plan: {
              patient: {
                memberships: { some: { userId, revokedAt: null } },
              },
            },
          },
        },
        select: {
          id: true,
          status: true,
          scheduledAt: true,
          planItem: {
            select: {
              plan: {
                select: {
                  patient: {
                    select: {
                      markOpenBeforeMinutes: true,
                      markCloseAfterMinutes: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!occurrence) throw new NotFoundException('Occurrence not found.');
      const openBeforeMinutes =
        occurrence.planItem.plan.patient.markOpenBeforeMinutes ??
        DEFAULT_MARK_OPEN_BEFORE_MINUTES;
      const closeAfterMinutes =
        occurrence.planItem.plan.patient.markCloseAfterMinutes ??
        DEFAULT_MARK_CLOSE_AFTER_MINUTES;
      const now = new Date();
      const missedIds = await this.closeExpiredWindows(
        database,
        [occurrence],
        openBeforeMinutes,
        closeAfterMinutes,
        now,
      );
      const status = missedIds.has(occurrence.id)
        ? OccurrenceStatus.MISSED
        : occurrence.status;
      if (status === OccurrenceStatus.MISSED) {
        throw new ConflictException(
          'The marking window has closed. This task was missed.',
        );
      }
      const { opensAt, closesAt } = markingBounds(
        occurrence.scheduledAt,
        openBeforeMinutes,
        closeAfterMinutes,
      );
      const state = markingWindowState(now, opensAt, closesAt);
      if (state !== 'open') {
        throw new ConflictException(
          state === 'upcoming'
            ? 'This task is not open to mark yet.'
            : 'The marking window has closed.',
        );
      }

      const requestedStatus =
        action === 'done'
          ? OccurrenceStatus.DONE
          : action === 'skipped'
            ? OccurrenceStatus.SKIPPED
            : OccurrenceStatus.SCHEDULED;
      if (occurrence.status === requestedStatus) {
        const existing = await database.occurrenceLog.findFirst({
          where: { occurrenceId: id, action },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            action: true,
            reason: true,
            note: true,
            createdAt: true,
          },
        });
        if (!existing) {
          throw new ConflictException(
            action === 'undone'
              ? 'Occurrence is already not done.'
              : 'Occurrence has already been logged.',
          );
        }
        return {
          occurrenceId: id,
          status: requestedStatus.toLowerCase(),
          log: existing,
          idempotent: true,
          near: await this.nearActivity(database, existing.id),
        };
      }
      if (action !== 'undone' && occurrence.status !== 'SCHEDULED') {
        throw new ConflictException('Occurrence has already been logged.');
      }

      const updated = await database.occurrence.updateMany({
        where: { id, status: occurrence.status },
        data: { status: requestedStatus },
      });
      if (updated.count !== 1) {
        const current = await database.occurrence.findUnique({
          where: { id },
          select: { status: true },
        });
        if (current?.status === requestedStatus) {
          const existing = await database.occurrenceLog.findFirst({
            where: { occurrenceId: id, action },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              action: true,
              reason: true,
              note: true,
              createdAt: true,
            },
          });
          return {
            occurrenceId: id,
            status: requestedStatus.toLowerCase(),
            log: existing,
            idempotent: true,
            near: existing
              ? await this.nearActivity(database, existing.id)
              : null,
          };
        }
        throw new ConflictException('Occurrence has already been logged.');
      }
      const log = await database.occurrenceLog.create({
        data: {
          occurrenceId: id,
          actorUserId: userId,
          action,
          reason: action === 'skipped' ? reason : undefined,
          note:
            typeof note === 'string' && note.trim() ? note.trim() : undefined,
        },
        select: {
          id: true,
          action: true,
          reason: true,
          note: true,
          createdAt: true,
        },
      });
      return {
        occurrenceId: id,
        status: requestedStatus.toLowerCase(),
        log,
        idempotent: false,
        near: await this.nearActivity(database, log.id),
      };
    });
  }

  // Every done/skip/undo gets a private salted commitment in the same transaction; the
  // NEAR anchor and the person's optional signature follow later and never block the log.
  private async nearActivity(
    database: Prisma.TransactionClient,
    logId: string,
  ) {
    const event = await this.near.activity(database, logId);
    return event ? { eventId: event.id, digest: event.digest } : null;
  }

  private async closeExpiredWindows(
    database: Prisma.TransactionClient | PrismaService,
    occurrences: { id: string; status: OccurrenceStatus; scheduledAt: Date }[],
    openBeforeMinutes: number,
    closeAfterMinutes: number,
    now: Date,
  ): Promise<Set<string>> {
    const expired = occurrences.filter((item) => {
      if (item.status !== OccurrenceStatus.SCHEDULED) return false;
      const { closesAt } = markingBounds(
        item.scheduledAt,
        openBeforeMinutes,
        closeAfterMinutes,
      );
      return now.getTime() > closesAt.getTime();
    });
    if (!expired.length) return new Set();
    const changed = new Set<string>();
    for (const occurrence of expired) {
      if (await this.markMissed(database, occurrence.id)) {
        changed.add(occurrence.id);
      }
    }
    return changed;
  }

  private async markMissed(
    database: Prisma.TransactionClient | PrismaService,
    occurrenceId: string,
  ) {
    const updated = await database.occurrence.updateMany({
      where: { id: occurrenceId, status: OccurrenceStatus.SCHEDULED },
      data: { status: OccurrenceStatus.MISSED },
    });
    if (updated.count !== 1) return false;
    await database.occurrenceLog.create({
      data: {
        occurrenceId,
        action: 'missed',
        note: 'Marking window closed',
      },
    });
    return true;
  }

  private reviewCandidates(
    review: JsonObject,
    requireDecision = false,
  ): ReviewCandidate[] {
    if (!Array.isArray(review.candidates)) {
      throw new BadRequestException('Review candidates are required.');
    }
    return review.candidates.map((value, index) => {
      const candidate = object(value) as Partial<ReviewCandidate>;
      if (
        typeof candidate.candidate_id !== 'string' ||
        typeof candidate.category !== 'string' ||
        typeof candidate.instruction_text !== 'string' ||
        (candidate.action_text !== undefined &&
          typeof candidate.action_text !== 'string') ||
        !Array.isArray(candidate.fields) ||
        !Array.isArray(candidate.evidence_span_ids) ||
        (candidate.decision !== undefined &&
          !['accepted', 'rejected'].includes(candidate.decision)) ||
        (requireDecision && candidate.decision === undefined)
      ) {
        throw new BadRequestException(
          `Invalid review candidate at index ${index}.`,
        );
      }
      const schedule = object(candidate.schedule) as Partial<Schedule>;
      const kind =
        typeof schedule.kind === 'string' ? schedule.kind : 'unknown';
      if (!supportedScheduleKinds.has(kind)) {
        throw new BadRequestException(
          `Invalid schedule kind at candidate ${index}.`,
        );
      }
      candidate.schedule = {
        ...schedule,
        kind,
        times: uniqueClockTimes(
          Array.isArray(schedule.times)
            ? schedule.times.filter(
                (time): time is string => typeof time === 'string',
              )
            : [],
        ),
      };
      return candidate as ReviewCandidate;
    });
  }

  private async requireMembership(
    userId: string,
    patientId: string,
  ): Promise<void> {
    const membership = await this.prisma.careMembership.findFirst({
      where: { userId, patientId, revokedAt: null },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Patient not found.');
  }

  private validateSchedule(candidate: ReviewCandidate, today: string): void {
    if (!candidate.instruction_text.trim()) {
      throw new BadRequestException('This instruction needs instruction text.');
    }
    if (candidate.action_text !== undefined && !candidate.action_text.trim()) {
      throw new BadRequestException('This instruction needs action text.');
    }
    const unscheduled =
      candidate.category === 'restriction' ||
      ['persistent', 'as_needed'].includes(candidate.schedule.kind);
    if (!unscheduled && !candidate.schedule.times.length) {
      throw new BadRequestException(
        'This instruction needs at least one time.',
      );
    }
    if (
      candidate.schedule.times.some(
        (time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time),
      )
    ) {
      throw new BadRequestException(
        'This instruction contains an invalid time.',
      );
    }
    if (scheduleNeedsDayCount(candidate.category, candidate.schedule.kind)) {
      const dayCount = scheduleDayCount(
        candidate.schedule,
        scheduleStartDate(candidate.schedule, today),
      );
      if (dayCount < 1) {
        throw new BadRequestException(
          'This instruction needs a number of days.',
        );
      }
      if (dayCount > MAX_SCHEDULE_DAYS) {
        throw new BadRequestException(
          `This instruction cannot exceed ${MAX_SCHEDULE_DAYS} days.`,
        );
      }
    }
  }
}
