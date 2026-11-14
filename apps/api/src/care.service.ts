import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  AI_PROCESSING_CONSENT_VERSION,
  accountDeletionNotice,
  accountDeletionContact,
  canNotifyCareCircleMember,
  careInvitationEmail,
  hasCurrentAiProcessingConsent,
  invitationAllowed,
  invitationMatchesUser,
  normalizeExpoPushToken,
  normalizeInvitationContact,
  normalizePushPlatform,
  parseDailyRoutine,
  parseHealthProfile,
} from './care.utils';
import { CareRole, ExtractionStatus, Prisma } from './generated/prisma/client';
import { PrismaService } from './database/prisma.service';
import { DocumentStorageService } from './document-storage.service';
import { dateInZone, parseMarkingWindow } from './workflow.utils';
import { mobileDeepLink, sendResendEmail } from './email';

type StoredPath = string | null;

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) {
    throw new BadRequestException(
      `${label} is required and must be 80 characters or fewer.`,
    );
  }
  return value.trim();
}

function timezone(value: unknown): string {
  const zone = typeof value === 'string' && value ? value : 'Asia/Kolkata';
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    throw new BadRequestException('Invalid timezone.');
  }
  return zone;
}

function role(value: unknown): CareRole {
  if (value !== CareRole.PATIENT && value !== CareRole.CAREGIVER) {
    throw new BadRequestException('Role must be patient or caregiver.');
  }
  return value;
}

// Shared by the Rhythm screen and chat; callers check Care Circle access first.
export async function rhythmFor(prisma: PrismaService, patientId: string) {
  const patient = await prisma.patientProfile.findUniqueOrThrow({
    where: { id: patientId },
  });
  const today = dateInZone(new Date(), patient.timezone);
  const occurrences = await prisma.occurrence.findMany({
    where: {
      scheduledAt: {
        gte: new Date(Date.now() - 29 * 86_400_000),
        lte: new Date(Date.now() + 86_400_000),
      },
      planItem: { plan: { patientId } },
    },
    select: { status: true, scheduledAt: true },
  });
  const byDay = new Map<string, typeof occurrences>();
  for (const occurrence of occurrences) {
    const day = dateInZone(occurrence.scheduledAt, patient.timezone);
    const group = byDay.get(day) ?? [];
    group.push(occurrence);
    byDay.set(day, group);
  }
  const days = Array.from({ length: 28 }, (_, index) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (27 - index));
    const day = date.toISOString().slice(0, 10);
    const items = byDay.get(day) ?? [];
    return {
      day,
      total: items.length,
      done: items.filter((o) => o.status === 'DONE').length,
      skipped: items.filter((o) => o.status === 'SKIPPED').length,
      missed: items.filter((o) => o.status === 'MISSED').length,
    };
  });
  const recordedDays = days.filter((d) => d.done + d.skipped > 0).length;
  return {
    timezone: patient.timezone,
    days,
    recordedDays,
    label:
      recordedDays >= 14 ? 'Bloom' : recordedDays >= 7 ? 'Sprout' : 'Seedling',
  };
}

@Injectable()
export class CareService {
  private readonly logger = new Logger(CareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: DocumentStorageService,
  ) {}

  async rhythm(userId: string, patientId: string) {
    await this.membership(userId, patientId);
    return rhythmFor(this.prisma, patientId);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        phoneNumber: true,
        phoneNumberVerified: true,
        aiProcessingConsentVersion: true,
        careMemberships: {
          where: { revokedAt: null },
          orderBy: { joinedAt: 'asc' },
          select: {
            id: true,
            role: true,
            missedAlertsEnabled: true,
            patient: {
              select: {
                id: true,
                name: true,
                timezone: true,
                markOpenBeforeMinutes: true,
                markCloseAfterMinutes: true,
                dailyRoutine: true,
                memberships: {
                  where: { revokedAt: null },
                  select: { role: true },
                },
                documents: {
                  where: {
                    extractions: {
                      some: {
                        status: {
                          in: [
                            ExtractionStatus.QUEUED,
                            ExtractionStatus.PROCESSING,
                            ExtractionStatus.REVIEW_READY,
                          ],
                        },
                      },
                    },
                  },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: {
                    fileName: true,
                    extractions: {
                      where: {
                        status: {
                          in: [
                            ExtractionStatus.QUEUED,
                            ExtractionStatus.PROCESSING,
                            ExtractionStatus.REVIEW_READY,
                          ],
                        },
                      },
                      orderBy: { createdAt: 'desc' },
                      take: 1,
                      select: { id: true, status: true, planId: true },
                    },
                  },
                },
                plans: {
                  orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
                  select: {
                    id: true,
                    name: true,
                    status: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    const invitationContacts = [
      ...(user.emailVerified ? [{ email: user.email.toLowerCase() }] : []),
      ...(user.phoneNumberVerified && user.phoneNumber
        ? [{ phoneNumber: user.phoneNumber }]
        : []),
    ];
    const pendingInvitations = invitationContacts.length
      ? await this.prisma.careInvitation.findMany({
          where: {
            OR: invitationContacts,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            role: true,
            expiresAt: true,
            patient: { select: { id: true, name: true } },
            invitedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    return {
      user: {
        id: user.id,
        name: user.name,
        phoneNumber: user.phoneNumber,
        aiProcessingConsent: hasCurrentAiProcessingConsent(
          user.aiProcessingConsentVersion,
        ),
      },
      memberships: user.careMemberships.map(({ patient, ...membership }) => {
        const document = patient.documents[0];
        const extraction = document?.extractions[0];
        return {
          ...membership,
          patient: {
            id: patient.id,
            name: patient.name,
            timezone: patient.timezone,
            hasActivePlan: patient.plans.some(
              (plan) => plan.status === 'ACTIVE',
            ),
            plans: patient.plans.map((plan) => ({
              id: plan.id,
              name: plan.name,
              status: plan.status.toLowerCase(),
            })),
            markingWindow: {
              openBeforeMinutes: patient.markOpenBeforeMinutes,
              closeAfterMinutes: patient.markCloseAfterMinutes,
            },
            dailyRoutine: patient.dailyRoutine ?? undefined,
            resumableExtraction: extraction
              ? {
                  id: extraction.id,
                  status: extraction.status.toLowerCase(),
                  fileName: document.fileName,
                  planId: extraction.planId || undefined,
                }
              : undefined,
          },
          canInviteRole:
            membership.role === CareRole.PATIENT
              ? CareRole.CAREGIVER
              : patient.memberships.some(
                    ({ role }) => role === CareRole.PATIENT,
                  )
                ? undefined
                : CareRole.PATIENT,
        };
      }),
      pendingInvitations,
    };
  }

  async createPatient(userId: string, value: unknown) {
    const body = object(value);
    const patientRole = role(body.role);
    const patientName = text(body.patientName, "Patient's name");
    const userName = text(body.userName, 'Your name');
    const patientTimezone = timezone(body.timezone);
    const dailyRoutine =
      body.dailyRoutine === undefined
        ? undefined
        : parseDailyRoutine(body.dailyRoutine);
    const healthProfile =
      body.healthProfile === undefined
        ? undefined
        : parseHealthProfile(body.healthProfile);
    const existing = await this.prisma.careMembership.findFirst({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    if (existing)
      throw new ConflictException('Your Care Circle is already set up.');

    return this.prisma.$transaction(async (database) => {
      await database.user.update({
        where: { id: userId },
        data: { name: userName },
      });
      const patient = await database.patientProfile.create({
        data: {
          name: patientName,
          timezone: patientTimezone,
          dailyRoutine,
          healthProfile,
          createdById: userId,
          memberships: { create: { userId, role: patientRole } },
        },
      });
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId: patient.id,
          action: 'patient.created',
        },
      });
      return { patientId: patient.id, role: patientRole };
    });
  }

  async invite(userId: string, patientId: string, value: unknown) {
    const body = object(value);
    const linkBase = mobileDeepLink(this.config, 'INVITATION', body.mobileApp);
    const invitedRole = role(body.role);
    const invitedContact = normalizeInvitationContact(
      body.contact ?? body.phoneNumber,
    );
    const membership = await this.membership(userId, patientId);

    if (!invitationAllowed(membership.role, invitedRole)) {
      throw new ForbiddenException('You cannot invite that role.');
    }
    if (invitationMatchesUser(invitedContact, membership.user)) {
      throw new BadRequestException('You are already in this Care Circle.');
    }
    const existingMember = await this.prisma.careMembership.findFirst({
      where: {
        patientId,
        revokedAt: null,
        user: invitedContact,
      },
    });
    if (existingMember)
      throw new ConflictException(
        'That person is already in this Care Circle.',
      );
    if (invitedRole === CareRole.PATIENT) {
      const patientExists = await this.prisma.careMembership.findFirst({
        where: { patientId, role: CareRole.PATIENT, revokedAt: null },
      });
      if (patientExists)
        throw new ConflictException('This patient has already joined.');
    }

    let invitation = await this.prisma.careInvitation.findFirst({
      where: {
        patientId,
        ...invitedContact,
        role: invitedRole,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!invitation) {
      invitation = await this.prisma.$transaction(async (database) => {
        const created = await database.careInvitation.create({
          data: {
            patientId,
            invitedById: userId,
            ...invitedContact,
            role: invitedRole,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await database.auditEvent.create({
          data: {
            actorUserId: userId,
            patientId,
            action: 'invitation.created',
            metadata: { role: invitedRole },
          },
        });
        return created;
      });
    }

    const link = `${linkBase.replace(/\/$/, '')}/${invitation.id}`;
    await sendResendEmail(this.config, {
      to: invitedContact.email,
      ...careInvitationEmail({ link }),
      idempotencyKey: `care-invitation/${invitation.id}/web`,
    });

    return { invitationId: invitation.id, status: 'pending' };
  }

  async acceptInvitation(userId: string, invitationId: string, value: unknown) {
    const body = object(value);
    const name = text(body.name, 'Your name');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const invitation = await this.prisma.careInvitation.findFirst({
      where: { id: invitationId, acceptedAt: null, revokedAt: null },
    });
    if (!user || !invitation || !invitationMatchesUser(invitation, user)) {
      throw new NotFoundException('Invitation not found.');
    }
    if (invitation.expiresAt <= new Date())
      throw new ConflictException('Invitation expired.');
    if (invitation.role === CareRole.PATIENT) {
      const patientExists = await this.prisma.careMembership.findFirst({
        where: {
          patientId: invitation.patientId,
          role: CareRole.PATIENT,
          revokedAt: null,
          userId: { not: userId },
        },
      });
      if (patientExists)
        throw new ConflictException('This patient has already joined.');
    }

    return this.prisma.$transaction(async (database) => {
      const claimed = await database.careInvitation.updateMany({
        where: { id: invitationId, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Invitation was already accepted.');
      await database.user.update({ where: { id: userId }, data: { name } });
      await database.careMembership.upsert({
        where: {
          patientId_userId: { patientId: invitation.patientId, userId },
        },
        update: { role: invitation.role, revokedAt: null },
        create: {
          patientId: invitation.patientId,
          userId,
          role: invitation.role,
        },
      });
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId: invitation.patientId,
          action: 'invitation.accepted',
          metadata: { role: invitation.role },
        },
      });
      return { patientId: invitation.patientId, role: invitation.role };
    });
  }

  async declineInvitation(userId: string, invitationId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const invitation = await this.prisma.careInvitation.findFirst({
      where: {
        id: invitationId,
        acceptedAt: null,
        revokedAt: null,
      },
    });
    if (!user || !invitation || !invitationMatchesUser(invitation, user)) {
      throw new NotFoundException('Invitation not found.');
    }
    await this.prisma.$transaction(async (database) => {
      const declined = await database.careInvitation.updateMany({
        where: { id: invitationId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (declined.count !== 1) {
        throw new ConflictException('Invitation is no longer available.');
      }
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId: invitation.patientId,
          action: 'invitation.declined',
        },
      });
    });
    return { status: 'declined' };
  }

  async updateMarkingWindow(userId: string, patientId: string, value: unknown) {
    const membership = await this.membership(userId, patientId);
    // ponytail: hospital and design-partner admins should share this when org accounts exist.
    if (membership.role !== CareRole.CAREGIVER) {
      throw new ForbiddenException(
        'Only a care partner can change the marking window.',
      );
    }
    const markingWindow = parseMarkingWindow(value);
    await this.prisma.$transaction(async (database) => {
      await database.patientProfile.update({
        where: { id: patientId },
        data: {
          markOpenBeforeMinutes: markingWindow.openBeforeMinutes,
          markCloseAfterMinutes: markingWindow.closeAfterMinutes,
        },
      });
      await database.auditEvent.create({
        data: {
          actorUserId: userId,
          patientId,
          action: 'marking_window.updated',
          metadata: markingWindow,
        },
      });
    });
    return markingWindow;
  }

  async updateCareCircleNotifications(
    userId: string,
    patientId: string,
    value: unknown,
  ) {
    const membership = await this.membership(userId, patientId);
    if (membership.role !== CareRole.CAREGIVER) {
      throw new ForbiddenException(
        'Only a care partner can receive Care Circle alerts.',
      );
    }
    const body = object(value);
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('Enabled must be true or false.');
    }
    const enabled = body.enabled;
    const token = enabled
      ? normalizeExpoPushToken(body.expoPushToken)
      : undefined;
    const platform = enabled ? normalizePushPlatform(body.platform) : undefined;

    await this.prisma.$transaction(async (database) => {
      if (token && platform) {
        await database.pushDevice.upsert({
          where: { expoPushToken: token },
          update: {
            userId,
            platform,
            disabledAt: null,
            lastSeenAt: new Date(),
          },
          create: { userId, expoPushToken: token, platform },
        });
      }
      await database.careMembership.update({
        where: { id: membership.id },
        data: {
          missedAlertsEnabled: enabled,
          missedAlertsEnabledAt: enabled
            ? membership.missedAlertsEnabled
              ? membership.missedAlertsEnabledAt
              : new Date()
            : null,
        },
      });
      if (!enabled) {
        await database.notificationDelivery.updateMany({
          where: {
            membershipId: membership.id,
            status: 'PENDING',
          },
          data: {
            status: 'FAILED',
            error: 'Canceled when Care Circle alerts were disabled.',
          },
        });
      }
      if (membership.missedAlertsEnabled !== enabled) {
        await database.auditEvent.create({
          data: {
            actorUserId: userId,
            patientId,
            action: enabled
              ? 'care_circle_notifications.enabled'
              : 'care_circle_notifications.disabled',
          },
        });
      }
    });
    return { missedAlertsEnabled: enabled };
  }

  async updateAiProcessingConsent(userId: string, value: unknown) {
    const accepted = object(value).accepted;
    if (typeof accepted !== 'boolean') {
      throw new BadRequestException('accepted must be true or false.');
    }
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: accepted
        ? {
            aiProcessingConsentVersion: AI_PROCESSING_CONSENT_VERSION,
            aiProcessingConsentedAt: now,
            aiProcessingConsentWithdrawnAt: null,
          }
        : {
            aiProcessingConsentVersion: null,
            aiProcessingConsentWithdrawnAt: now,
          },
    });
    return {
      accepted,
      version: accepted ? AI_PROCESSING_CONSENT_VERSION : null,
    };
  }

  async deleteAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        careMemberships: {
          where: { revokedAt: null },
          select: {
            role: true,
            patient: {
              select: {
                id: true,
                name: true,
                memberships: {
                  where: { revokedAt: null, userId: { not: userId } },
                  select: {
                    user: {
                      select: { email: true, emailVerified: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found.');

    const createdProfiles = await this.prisma.patientProfile.findMany({
      where: { createdById: userId },
      select: {
        id: true,
        memberships: {
          where: { revokedAt: null, userId: { not: userId } },
          select: { id: true },
        },
      },
    });
    const profileIds = new Set<string>();
    for (const membership of user.careMemberships) {
      if (
        membership.role === CareRole.PATIENT ||
        membership.patient.memberships.length === 0
      ) {
        profileIds.add(membership.patient.id);
      }
    }
    for (const profile of createdProfiles) {
      if (profile.memberships.length === 0) profileIds.add(profile.id);
    }

    const notices = new Map<
      string,
      {
        to: string;
        patientId: string;
        patientName: string;
        removesCareRecord: boolean;
      }
    >();
    for (const membership of user.careMemberships) {
      for (const other of membership.patient.memberships) {
        if (!canNotifyCareCircleMember(other.user)) continue;
        const to = other.user.email.trim().toLowerCase();
        notices.set(`${to}:${membership.patient.id}`, {
          to,
          patientId: membership.patient.id,
          patientName: membership.patient.name,
          removesCareRecord: membership.role === CareRole.PATIENT,
        });
      }
    }
    for (const notice of notices.values()) {
      const message = accountDeletionNotice({
        name: user.name,
        patientName: notice.patientName,
        removesCareRecord: notice.removesCareRecord,
      });
      await sendResendEmail(this.config, {
        to: notice.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        idempotencyKey: `account-deletion/${createHash('sha256')
          .update(`${userId}/${notice.patientId}/${notice.to}`)
          .digest('hex')}`,
      });
    }

    const storedPaths = await this.prisma.$transaction(
      async (database) => {
        const paths = await this.removePatientProfiles(database, [
          ...profileIds,
        ]);
        await database.document.updateMany({
          where: { uploadedById: userId },
          data: { uploadedById: null },
        });
        await database.plan.updateMany({
          where: { confirmedById: userId },
          data: { confirmedById: null },
        });
        await database.occurrenceLog.updateMany({
          where: { actorUserId: userId },
          data: { actorUserId: null },
        });
        await database.auditEvent.deleteMany({
          where: { actorUserId: userId },
        });
        await database.careInvitation.updateMany({
          where: {
            acceptedAt: null,
            revokedAt: null,
            OR: [
              { email: user.email.toLowerCase() },
              ...(user.phoneNumber ? [{ phoneNumber: user.phoneNumber }] : []),
            ],
          },
          data: { revokedAt: new Date() },
        });
        await database.careInvitation.deleteMany({
          where: { invitedById: userId },
        });

        const stillCreated = await database.patientProfile.findMany({
          where: { createdById: userId },
          select: { id: true },
        });
        for (const profile of stillCreated) {
          const replacement = await database.careMembership.findFirst({
            where: {
              patientId: profile.id,
              revokedAt: null,
              userId: { not: userId },
            },
            orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
            select: { userId: true },
          });
          if (!replacement) {
            paths.push(
              ...(await this.removePatientProfiles(database, [profile.id])),
            );
            continue;
          }
          await database.patientProfile.update({
            where: { id: profile.id },
            data: { createdById: replacement.userId },
          });
        }

        const identifiers = [user.email, user.phoneNumber].filter(
          (identifier): identifier is string => Boolean(identifier),
        );
        if (identifiers.length) {
          await database.verification.deleteMany({
            where: { identifier: { in: identifiers } },
          });
        }
        await database.accountDeletionRequest.updateMany({
          where: {
            OR: [
              { email: user.email.toLowerCase() },
              ...(user.phoneNumber ? [{ phoneNumber: user.phoneNumber }] : []),
            ],
          },
          data: {
            email: null,
            phoneNumber: null,
            resolvedAt: new Date(),
          },
        });
        await database.user.delete({ where: { id: userId } });
        return paths;
      },
      { timeout: 20_000 },
    );

    await this.removeStoredFiles(storedPaths).catch(() => {
      this.logger.warn(
        'Account deleted, but some stored document files could not be removed.',
      );
    });
    return { status: 'deleted' };
  }

  async requestAccountDeletion(value: unknown) {
    const { email, phoneNumber } = accountDeletionContact(value);
    const recent = await this.prisma.accountDeletionRequest.findFirst({
      where: {
        resolvedAt: null,
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        OR: [
          ...(email ? [{ email }] : []),
          ...(phoneNumber ? [{ phoneNumber }] : []),
        ],
      },
      select: { id: true, notifiedAt: true },
    });
    if (recent?.notifiedAt) return { status: 'received' };

    if (!recent) {
      // shortcut: this global cap bounds anonymous writes; use edge rate limiting if public request volume grows.
      const hourlyCount = await this.prisma.accountDeletionRequest.count({
        where: { createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      });
      if (hourlyCount >= 60) {
        throw new HttpException('Please try again later.', 429);
      }
    }

    const request =
      recent ??
      (await this.prisma.accountDeletionRequest.create({
        data: { email, phoneNumber },
        select: { id: true },
      }));
    try {
      await sendResendEmail(this.config, {
        to: this.config.getOrThrow<string>('ACCOUNT_DELETION_EMAIL'),
        subject: 'Kuvos account deletion request',
        text: `A new account deletion request was submitted. Request ID: ${request.id}. Verify identity before deleting any account.`,
        html: `<p>A new account deletion request was submitted.</p><p>Request ID: ${request.id}</p><p>Verify identity before deleting any account.</p>`,
        idempotencyKey: `account-deletion-request/${request.id}`,
      });
      await this.prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: { notifiedAt: new Date() },
      });
    } catch {
      // shortcut: failed notices stay in the request table for manual review; add retry delivery when request volume requires it.
      this.logger.warn(
        'Account deletion request saved, but notification failed.',
      );
    }
    return { status: 'received' };
  }

  async unregisterPushDevice(userId: string, value: unknown) {
    const token = normalizeExpoPushToken(object(value).expoPushToken);
    await this.prisma.pushDevice.updateMany({
      where: { userId, expoPushToken: token, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    return { status: 'unregistered' };
  }

  private async removePatientProfiles(
    database: Prisma.TransactionClient,
    patientIds: string[],
  ): Promise<StoredPath[]> {
    if (!patientIds.length) return [];
    const documents = await database.document.findMany({
      where: { patientId: { in: patientIds } },
      select: {
        path: true,
        extractions: { select: { runDir: true } },
      },
    });
    await database.planItem.deleteMany({
      where: {
        OR: [
          { plan: { patientId: { in: patientIds } } },
          { extraction: { document: { patientId: { in: patientIds } } } },
        ],
      },
    });
    await database.extraction.updateMany({
      where: {
        OR: [
          { document: { patientId: { in: patientIds } } },
          { plan: { patientId: { in: patientIds } } },
        ],
      },
      data: { planId: null },
    });
    await database.plan.deleteMany({
      where: { patientId: { in: patientIds } },
    });
    await database.document.deleteMany({
      where: { patientId: { in: patientIds } },
    });
    await database.patientProfile.deleteMany({
      where: { id: { in: patientIds } },
    });
    return documents.flatMap((document) => [
      document.path,
      ...document.extractions
        .map((extraction) => extraction.runDir)
        .filter((path) => !path?.startsWith('s3://')),
    ]);
  }

  private async removeStoredFiles(paths: StoredPath[]) {
    const root = resolve(this.config.get('KUVOS_DATA_DIR', 'data'));
    const unique = [
      ...new Set(paths.filter((path): path is string => Boolean(path))),
    ];
    await Promise.all(
      unique.map(async (path) => {
        if (path.startsWith('s3://')) {
          await this.storage.removeDocument(path);
          return;
        }
        const resolved = resolve(path);
        if (!resolved.startsWith(`${root}${sep}`)) return;
        await rm(resolved, { recursive: true, force: true });
      }),
    );
  }

  private async membership(userId: string, patientId: string) {
    const membership = await this.prisma.careMembership.findFirst({
      where: { userId, patientId, revokedAt: null },
      include: { user: true },
    });
    if (!membership) throw new NotFoundException('Patient not found.');
    return membership;
  }
}
