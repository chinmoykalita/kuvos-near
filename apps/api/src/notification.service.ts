import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  CareRole,
  NotificationDeliveryStatus,
  OccurrenceStatus,
  PlanStatus,
} from './generated/prisma/client';
import { PrismaService } from './database/prisma.service';
import { WorkflowService } from './workflow.service';
import { careCircleDeliveryTime } from './workflow.utils';
import {
  careCirclePushMessage,
  firstExpoResult,
  nextPushAttempt,
  type ExpoResult,
} from './notification.utils';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const RECEIPT_DELAY_MS = 15 * 60_000;
const MAX_ATTEMPTS = 4;

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
  ) {}

  onModuleInit() {
    void this.run();
    this.timer = setInterval(() => void this.run(), 60_000);
    this.timer.unref();
  }

  private async run() {
    try {
      await this.tick();
    } catch (error) {
      this.logger.error(
        'Care Circle notification dispatch failed.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.workflow.closeDueOccurrences(now);
      await this.seedMissedAlerts(now);
      await this.submitPending(now);
      await this.checkReceipts(now);
    } finally {
      this.running = false;
    }
  }

  private async seedMissedAlerts(now: Date) {
    // ponytail: alerts older than a day are stale; add replay controls only if pilots need them.
    const occurrences = await this.prisma.occurrence.findMany({
      where: {
        status: OccurrenceStatus.MISSED,
        scheduledAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) },
        planItem: { plan: { status: PlanStatus.ACTIVE } },
      },
      select: {
        id: true,
        logs: {
          where: { action: 'missed' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        planItem: {
          select: {
            plan: {
              select: {
                patient: {
                  select: {
                    timezone: true,
                    memberships: {
                      where: {
                        role: CareRole.CAREGIVER,
                        revokedAt: null,
                        missedAlertsEnabled: true,
                      },
                      select: {
                        id: true,
                        missedAlertsEnabledAt: true,
                        user: {
                          select: {
                            pushDevices: {
                              where: { disabledAt: null },
                              select: { id: true },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const deliveries = occurrences.flatMap((occurrence) => {
      const missedAt = occurrence.logs[0]?.createdAt;
      if (!missedAt) return [];
      const patient = occurrence.planItem.plan.patient;
      const scheduledFor = careCircleDeliveryTime(now, patient.timezone);
      return patient.memberships.flatMap((membership) =>
        !membership.missedAlertsEnabledAt ||
        membership.missedAlertsEnabledAt > missedAt
          ? []
          : membership.user.pushDevices.map((device) => ({
              occurrenceId: occurrence.id,
              membershipId: membership.id,
              pushDeviceId: device.id,
              scheduledFor,
              nextAttemptAt: scheduledFor,
            })),
      );
    });
    if (deliveries.length) {
      await this.prisma.notificationDelivery.createMany({
        data: deliveries,
        skipDuplicates: true,
      });
    }
  }

  private async submitPending(now: Date) {
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        status: NotificationDeliveryStatus.PENDING,
        scheduledFor: { lte: now },
        nextAttemptAt: { lte: now },
        membership: {
          role: CareRole.CAREGIVER,
          revokedAt: null,
          missedAlertsEnabled: true,
        },
        pushDevice: { disabledAt: null },
        occurrence: {
          status: OccurrenceStatus.MISSED,
          planItem: { plan: { status: PlanStatus.ACTIVE } },
        },
      },
      include: {
        pushDevice: true,
        membership: { select: { userId: true } },
      },
      take: 100,
      orderBy: { scheduledFor: 'asc' },
    });
    // ponytail: one API instance sends serially; claim rows if the API gains replicas.
    for (const delivery of deliveries) {
      if (delivery.pushDevice.userId !== delivery.membership.userId) {
        await this.fail(delivery.id, 'Push device owner changed.');
        continue;
      }
      await this.submit(delivery, now);
    }
  }

  private async submit(
    delivery: {
      id: string;
      attempts: number;
      pushDeviceId: string;
      pushDevice: { expoPushToken: string; userId: string };
    },
    now: Date,
  ) {
    try {
      const response = await fetch(SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          careCirclePushMessage(delivery.pushDevice.expoPushToken),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) {
          await this.retry(delivery.id, delivery.attempts, now);
        } else {
          await this.fail(
            delivery.id,
            `Expo push rejected (${response.status}).`,
          );
        }
        return;
      }
      const ticket = firstExpoResult(await response.json());
      if (ticket?.status === 'ok' && ticket.id) {
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: NotificationDeliveryStatus.SUBMITTED,
            expoTicketId: ticket.id,
            submittedAt: now,
            attempts: { increment: 1 },
            error: null,
          },
        });
        return;
      }
      if (ticket?.details?.error === 'DeviceNotRegistered') {
        await this.disableDevice(delivery.pushDeviceId);
      }
      await this.fail(
        delivery.id,
        ticket?.message || 'Expo rejected the push.',
      );
    } catch {
      await this.retry(delivery.id, delivery.attempts, now);
    }
  }

  private async retry(deliveryId: string, attempts: number, now: Date) {
    const nextAttempts = attempts + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      await this.fail(deliveryId, 'Push delivery retries exhausted.');
      return;
    }
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: nextAttempts,
        nextAttemptAt: nextPushAttempt(now, nextAttempts),
      },
    });
  }

  private async fail(deliveryId: string, error: string) {
    await this.prisma.notificationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: NotificationDeliveryStatus.FAILED,
        attempts: { increment: 1 },
        error: error.slice(0, 500),
      },
    });
  }

  private async checkReceipts(now: Date) {
    const deliveries = await this.prisma.notificationDelivery.findMany({
      where: {
        status: NotificationDeliveryStatus.SUBMITTED,
        submittedAt: { lte: new Date(now.getTime() - RECEIPT_DELAY_MS) },
        receiptCheckedAt: null,
        expoTicketId: { not: null },
      },
      select: {
        id: true,
        expoTicketId: true,
        pushDeviceId: true,
        submittedAt: true,
      },
      take: 100,
    });
    if (!deliveries.length) return;
    try {
      const response = await fetch(RECEIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: deliveries.map((delivery) => delivery.expoTicketId),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const body = (await response.json()) as {
        data?: Record<string, ExpoResult>;
      };
      for (const delivery of deliveries) {
        const receipt = delivery.expoTicketId
          ? body.data?.[delivery.expoTicketId]
          : undefined;
        if (!receipt) {
          if (
            delivery.submittedAt &&
            now.getTime() - delivery.submittedAt.getTime() >= 24 * 60 * 60_000
          ) {
            await this.fail(delivery.id, 'Expo push receipt expired.');
          }
          continue;
        }
        if (receipt.details?.error === 'DeviceNotRegistered') {
          await this.disableDevice(delivery.pushDeviceId);
        }
        await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status:
              receipt.status === 'ok'
                ? NotificationDeliveryStatus.ACCEPTED
                : NotificationDeliveryStatus.FAILED,
            receiptCheckedAt: now,
            error:
              receipt.status === 'ok'
                ? null
                : (receipt.message || 'Push receipt failed.').slice(0, 500),
          },
        });
      }
    } catch {
      // The next tick retries receipt lookup while Expo retains it.
    }
  }

  private async disableDevice(pushDeviceId: string) {
    await this.prisma.pushDevice.update({
      where: { id: pushDeviceId },
      data: { disabledAt: new Date() },
    });
  }
}
