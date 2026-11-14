import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { WorkflowService } from '../workflow.service';
import { rhythmFor } from '../care.service';
import { physioCatalogue } from '../physio-catalogue';
import {
  DATE_ONLY,
  dateInZone,
  daysThrough,
  skipReasonOptions,
} from '../workflow.utils';
import {
  adviceText,
  messageBody,
  object,
  type ChatReply,
  type ToolCall,
  type ChatToolResult,
  type ChatEvidence,
  chatConsentVersion,
} from './chat.policy';
import { ChatModel } from './chat.model';
import { NearService } from '../near/near.service';
import {
  gate,
  GATE_HASH,
  GATE_RULES,
  type GateResult,
} from '../near/tomo-gate';
import { randomUUID } from 'node:crypto';

type Course = {
  first: Date;
  last: Date;
  done: number;
  skipped: number;
  missed: number;
  ahead: number;
};
type Day = Awaited<ReturnType<WorkflowService['getPatientToday']>>;

const skipLabel = (reason: string | null | undefined) =>
  reason
    ? (skipReasonOptions.find((option) => option.value === reason)?.label ??
      reason)
    : undefined;
const clock = (value: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(value);
const shiftDate = (date: string, days: number) => {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const relativeDays: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  yesterday: -1,
  'day after tomorrow': 2,
  'day before yesterday': -2,
};

// Describes the generated reminders, so Tomo can answer about past and future days without inferring a schedule.
function courseText(
  item: { category: string; schedule: unknown },
  course: Course | undefined,
  timezone: string,
  today: string,
) {
  const schedule = object(item.schedule);
  const kind = typeof schedule.kind === 'string' ? schedule.kind : '';
  if (item.category === 'restriction' || kind === 'persistent')
    return 'Ongoing restriction with no reminders.';
  if (kind === 'as_needed') return 'As needed, with no set reminder times.';
  if (!course) return 'No reminders are scheduled.';
  const times = Array.isArray(schedule.times)
    ? schedule.times.filter(
        (time): time is string =>
          typeof time === 'string' && /^\d{2}:\d{2}$/.test(time),
      )
    : [];
  const first = dateInZone(course.first, timezone);
  const last = dateInZone(course.last, timezone);
  const span = daysThrough(first, last);
  const timing =
    kind === 'once'
      ? `Once, on ${first}${times.length ? ` at ${times[0]}` : ''}`
      : `Reminders${times.length ? ` at ${times.join(', ')}` : ''}${kind === 'weekly' ? ' on the scheduled weekdays' : ''}, from ${first} to ${last} (${span} ${span === 1 ? 'day' : 'days'})`;
  const position =
    today < first
      ? `Starts ${first}.`
      : today > last
        ? `Finished ${last}.`
        : kind === 'once'
          ? 'Due today.'
          : `Today is day ${daysThrough(first, today)} of ${span}.`;
  return `${timing}, ${timezone}. ${position}\nRecorded so far: ${course.done} done, ${course.skipped} explicitly skipped, ${course.missed} closed without a check-in; ${course.ahead} still ahead or not checked yet.`;
}

@Injectable()
export class ChatService {
  private active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly model: ChatModel,
    private readonly near: NearService,
  ) {}

  private async access(userId: string, patientId: string) {
    const member = await this.prisma.careMembership.findFirst({
      where: { userId, patientId, revokedAt: null },
      select: {
        role: true,
        patient: { select: { name: true, timezone: true } },
        user: {
          select: {
            name: true,
            chatProcessingConsentedAt: true,
            chatProcessingConsentVersion: true,
          },
        },
      },
    });
    if (!member) throw new NotFoundException('Care Circle not found.');
    return member;
  }

  private hasConsent(user: {
    chatProcessingConsentedAt: Date | null;
    chatProcessingConsentVersion: string | null;
  }) {
    return (
      !!user.chatProcessingConsentedAt &&
      user.chatProcessingConsentVersion === chatConsentVersion
    );
  }

  async state(userId: string, patientId: string) {
    const member = await this.access(userId, patientId);
    const [turns, memories, helpers] = await Promise.all([
      // shortcut: return the latest 40 turns; add cursor pagination when longer history is needed.
      this.prisma.chatTurn.findMany({
        where: { userId, patientId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 40,
      }),
      this.prisma.chatMemory.findMany({
        where: { userId, patientId },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
      this.prisma.careMembership.findMany({
        where: {
          patientId,
          revokedAt: null,
          role: 'CAREGIVER',
          userId: { not: userId },
          user: { phoneNumberVerified: true },
        },
        select: {
          user: { select: { id: true, name: true, phoneNumber: true } },
        },
      }),
    ]);
    await this.access(userId, patientId);
    return {
      patientName: member.patient.name,
      turns: turns.reverse(),
      memories,
      contacts: helpers.flatMap(({ user }) =>
        user.phoneNumber && /^\+?[0-9]{6,15}$/.test(user.phoneNumber)
          ? [{ id: user.id, name: user.name, phone: user.phoneNumber }]
          : [],
      ),
      externalAvailable: ['ready', 'consent_required'].includes(
        this.model.connectionStatus(this.hasConsent(member.user)),
      ),
      externalConsent: this.hasConsent(member.user),
      consentVersion: chatConsentVersion,
      connectionStatus: this.model.connectionStatus(
        this.hasConsent(member.user),
      ),
    };
  }

  async consent(userId: string, value: unknown) {
    const accepted = object(value).accepted;
    if (typeof accepted !== 'boolean')
      throw new BadRequestException('Choose whether to allow chat processing.');
    if (accepted && object(value).version !== chatConsentVersion)
      throw new BadRequestException(
        'Please review the current chat privacy notice before continuing.',
      );
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        chatProcessingConsentedAt: accepted ? new Date() : null,
        chatProcessingConsentVersion: accepted ? chatConsentVersion : null,
      },
    });
    return { accepted };
  }

  async forget(userId: string, patientId: string, id: string) {
    await this.access(userId, patientId);
    await this.prisma.$transaction(async (database) => {
      const removed = await database.chatMemory.deleteMany({
        where: { id, userId, patientId },
      });
      if (removed.count)
        await database.chatTurn.create({
          data: {
            userId,
            patientId,
            requestId: randomUUID(),
            text: 'Forget a saved note.',
            reply: {
              kind: 'answer',
              text: 'That note is no longer in active memory.',
              links: [],
              contextReset: true,
            },
          },
        });
    });
    return { status: 'forgotten' };
  }

  async clear(userId: string, patientId: string) {
    await this.access(userId, patientId);
    if (this.active.has(`${userId}:${patientId}`))
      throw new ConflictException(
        'Wait for the current reply before clearing the conversation.',
      );
    await this.prisma.chatTurn.deleteMany({ where: { userId, patientId } });
    return { status: 'cleared' };
  }

  private async modelReply(
    userId: string,
    patientId: string,
    text: string,
  ): Promise<ChatReply> {
    const check = async () => {
      const member = await this.access(userId, patientId);
      const status = this.model.connectionStatus(this.hasConsent(member.user));
      if (status === 'not_configured')
        throw new ServiceUnavailableException(
          'AI chat is not connected on the server yet. Your care plan and contact options are still available.',
        );
      if (status === 'awaiting_approval')
        throw new ServiceUnavailableException(
          'AI chat is awaiting activation for this deployment. Your care plan and contact options are still available.',
        );
      if (status === 'consent_required')
        throw new ForbiddenException(
          'Please review and accept the chat privacy notice before chatting.',
        );
      return member;
    };
    await check();
    const lastReset = await this.prisma.chatTurn.findFirst({
      where: {
        userId,
        patientId,
        reply: { path: ['contextReset'], equals: true },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const recent = await this.prisma.chatTurn.findMany({
      where: { userId, patientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 8,
    });
    const ordered = recent.reverse();
    const reset = ordered.findLastIndex(
      (turn) => object(turn.reply).contextReset === true,
    );
    const history = ordered
      .slice(reset + 1)
      .filter((turn) => !/^remember\s/i.test(turn.text))
      .map((turn) => {
        const reply = object(turn.reply);
        // Never replay tool excerpts or saved-note commands: forgotten memory must not be reconstructed from history.
        // Record IDs and markers tell the model each earlier question was already answered.
        const shown = Array.isArray(reply.evidenceIds)
          ? reply.evidenceIds.filter((id) => typeof id === 'string')
          : [];
        return {
          text: turn.text,
          message:
            typeof reply.message === 'string'
              ? `${reply.message}${shown.length ? `\n[Records shown: ${shown.join(', ')}]` : ''}`
              : reply.kind === 'boundary' || reply.kind === 'emergency'
                ? '[Contact guidance was shown.]'
                : '[A fixed app reply was shown.]',
        };
      });
    const reply = await this.model.reply(
      {
        text,
        history,
      },
      async (call) => {
        await check();
        return this.read(userId, patientId, call);
      },
      async () => {
        await check();
      },
    );
    if (reply.kind === 'answer') reply.contextResetId = lastReset?.id ?? null;
    const memoryIds =
      reply.evidenceIds
        ?.filter((id) => id.startsWith('memory:'))
        .map((id) => id.slice(7)) ?? [];
    if (memoryIds.length) {
      const current = await this.prisma.chatMemory.findMany({
        where: { userId, patientId, id: { in: memoryIds } },
        select: { id: true },
      });
      if (current.length !== memoryIds.length)
        throw new ConflictException(
          'Your saved notes changed while replying. Please retry.',
        );
    }
    return reply;
  }

  async send(userId: string, patientId: string, value: unknown) {
    const input = messageBody(value);
    await this.access(userId, patientId);
    const where = {
      userId_patientId_requestId: {
        userId,
        patientId,
        requestId: input.requestId,
      },
    };
    const previous = await this.prisma.chatTurn.findUnique({ where });
    if (previous) {
      if (previous.text !== input.text)
        throw new ConflictException(
          'This request ID was already used for a different message.',
        );
      return previous;
    }
    // Every turn passes the published Tomo gate first. Emergency, ESCALATE and BLOCK routes
    // answer with fixed text and never reach a model.
    const decision = gate(input.text);
    const label = (result: GateResult) => ({
      decision: result.decision,
      rule: result.rule,
      policyVersion: GATE_RULES.version,
      policyHash: GATE_HASH,
    });
    if (decision.rule === 'emergency') {
      this.model.trace('turn', { route: 'emergency', text: input.text });
      const reply: ChatReply = {
        text: decision.reply!,
        kind: 'emergency',
        links: [],
        gate: label(decision),
      };
      const urgent = await this.prisma.$transaction(async (database) => {
        const existing = await database.chatTurn.findUnique({ where });
        if (existing) return existing;
        const turn = await database.chatTurn.create({
          data: {
            userId,
            patientId,
            requestId: input.requestId,
            text: input.text,
            reply,
          },
        });
        await this.near.gateDecision(database, turn, decision, reply);
        return turn;
      });
      if (urgent.text !== input.text)
        throw new ConflictException('This request ID was already used.');
      return urgent;
    }
    if (
      (await this.prisma.chatTurn.count({
        where: { userId, createdAt: { gt: new Date(Date.now() - 60_000) } },
      })) >= 20
    ) {
      throw new ConflictException(
        'Please wait a minute before sending more messages.',
      );
    }
    const key = `${userId}:${patientId}`;
    if (this.active.has(key))
      throw new ConflictException('Please wait for the current reply.');
    // shortcut: one in-flight turn per account/patient in this API process; use a shared limiter before scaling replicas.
    this.active.add(key);
    try {
      let reply: ChatReply;
      let note: string | undefined;
      let route = 'model';
      // Saving the person's own words is not advice, so notes about symptoms can be kept for a visit.
      if (decision.rule === 'note') {
        if (/^remember\s+(?:that|this:?)$/i.test(input.text))
          throw new BadRequestException('Add your note after “Remember that”.');
        note = /^remember\s+(?:that\s+|this:\s*)?(.+)/i
          .exec(input.text)![1]
          .trim();
        if (note.length > 500)
          throw new BadRequestException('Keep a saved note to 500 characters.');
        route = 'remember';
        reply = {
          text: 'Got it, I’ll hold on to that for you. It stays private, it won’t change your plan, and you can remove it any time in Memory.',
          kind: 'answer',
          links: [],
          tool: 'save_memory',
        };
      } else if (decision.decision !== 'ALLOW') {
        route = `gate ${decision.decision.toLowerCase()}`;
        reply = {
          text: decision.reply!,
          kind: 'boundary',
          links: [],
        };
      } else {
        reply = await this.modelReply(userId, patientId, input.text);
      }
      this.model.trace('turn', {
        route,
        text: input.text,
        kind: reply.kind,
        reply: reply.text,
      });
      reply.gate = label(decision);
      // A fresh membership check prevents a response being saved after access is revoked during generation.
      await this.access(userId, patientId);
      try {
        return await this.prisma.$transaction(
          async (database) => {
            if ('contextResetId' in reply) {
              const reset = await database.chatTurn.findFirst({
                where: {
                  userId,
                  patientId,
                  reply: { path: ['contextReset'], equals: true },
                },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: { id: true },
              });
              if ((reset?.id ?? null) !== reply.contextResetId)
                throw new ConflictException(
                  'Your saved notes changed while replying. Please retry.',
                );
            }
            if (note) {
              if (
                (await database.chatMemory.count({
                  where: { userId, patientId },
                })) >= 20
              )
                throw new BadRequestException(
                  'Memory is full. Forget a note before adding another.',
                );
              await database.chatMemory.create({
                data: { userId, patientId, text: note },
              });
            }
            const turn = await database.chatTurn.create({
              data: {
                userId,
                patientId,
                requestId: input.requestId,
                text: input.text,
                reply: reply,
              },
            });
            await this.near.gateDecision(database, turn, decision, reply);
            return turn;
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const existing = await this.prisma.chatTurn.findUniqueOrThrow({
            where,
          });
          if (existing.text !== input.text)
            throw new ConflictException('This request ID was already used.');
          return existing;
        }
        throw error;
      }
    } finally {
      this.active.delete(key);
    }
  }

  // Grouped counts keep long courses (up to 366 days) cheap enough to preload every turn.
  private async courses(patientId: string, itemIds: string[]) {
    const patient = await this.prisma.patientProfile.findUniqueOrThrow({
      where: { id: patientId },
      select: { timezone: true, markCloseAfterMinutes: true },
    });
    const timezone = patient.timezone;
    const today = dateInZone(new Date(), timezone);
    const cutoff = new Date(
      Date.now() - patient.markCloseAfterMinutes * 60_000,
    );
    const courses = new Map<string, Course>();
    if (!itemIds.length) return { courses, timezone, today, cutoff };
    const where = { planItemId: { in: itemIds } };
    const [spans, closed, open] = await Promise.all([
      this.prisma.occurrence.groupBy({
        by: ['planItemId'],
        where,
        _min: { scheduledAt: true },
        _max: { scheduledAt: true },
      }),
      this.prisma.occurrence.groupBy({
        by: ['planItemId', 'status'],
        where: { ...where, scheduledAt: { lt: cutoff } },
        _count: { _all: true },
      }),
      this.prisma.occurrence.groupBy({
        by: ['planItemId', 'status'],
        where: { ...where, scheduledAt: { gte: cutoff } },
        _count: { _all: true },
      }),
    ]);
    for (const span of spans)
      if (span._min.scheduledAt && span._max.scheduledAt)
        courses.set(span.planItemId, {
          first: span._min.scheduledAt,
          last: span._max.scheduledAt,
          done: 0,
          skipped: 0,
          missed: 0,
          ahead: 0,
        });
    for (const [rows, past] of [
      [closed, true],
      [open, false],
    ] as const)
      for (const row of rows) {
        const course = courses.get(row.planItemId);
        if (!course) continue;
        const count = row._count._all;
        if (row.status === 'DONE') course.done += count;
        else if (row.status === 'SKIPPED') course.skipped += count;
        // Unchecked reminders past their window are closed even before the sweep marks them.
        else if (row.status === 'MISSED' || past) course.missed += count;
        else course.ahead += count;
      }
    return { courses, timezone, today, cutoff };
  }

  private dayFacts(day: Day, live: boolean): ChatEvidence[] {
    const items = day.occurrences;
    const count = (status: string) =>
      items.filter((item) => item.status === status).length;
    const future = day.date > dateInZone(new Date(), day.timezone);
    const summary: ChatEvidence = {
      id: `${live ? 'today' : 'day'}:${day.date}`,
      text: future
        ? `Scheduled for ${day.date} (${day.timezone}): ${items.length} ${items.length === 1 ? 'task' : 'tasks'}.`
        : `Recorded day: ${day.date} (${day.timezone}). ${count('done')} of ${items.length} recorded done; ${count('skipped')} explicitly skipped; ${count('scheduled')} not checked yet; ${count('missed')} windows closed without a check-in. A log records an action; it does not prove treatment completion.`,
      links: [{ label: 'View Today', kind: 'today' }],
    };
    return [summary, ...items.slice(0, 24).map((item) => this.task(day, item))];
  }

  private task(day: Day, item: Day['occurrences'][number]): ChatEvidence {
    const reason = skipLabel(item.reason);
    const status =
      item.status === 'done'
        ? 'recorded done'
        : item.status === 'skipped'
          ? 'explicitly skipped'
          : item.status === 'missed'
            ? 'window closed without a check-in'
            : day.date > dateInZone(new Date(), day.timezone)
              ? 'upcoming'
              : 'not checked yet';
    return {
      id: `task:${item.id}`,
      text: `Confirmed task for ${day.date} at ${clock(item.scheduledAt, day.timezone)} (${day.timezone})${item.planName ? `, ${item.planName} plan` : ''}:\n“${item.instructionText}”\nRecorded status: ${status}${item.loggedBy ? `; recorded by ${item.loggedBy}` : ''}${reason ? `; reason: ${reason}` : ''}.`,
      links: [
        {
          label: item.actionText,
          kind: 'task',
          id: item.id,
          planId: item.planId,
          date: day.date,
        },
      ],
    };
  }

  private async read(
    userId: string,
    patientId: string,
    call: ToolCall,
  ): Promise<ChatToolResult> {
    if (call.name === 'get_profile') {
      const member = await this.access(userId, patientId);
      const accountName = member.user.name.trim();
      const knownName = ['Kuvos user'].includes(accountName) ? '' : accountName;
      const name =
        knownName || (member.role === 'PATIENT' ? member.patient.name : '');
      // Names, roles and call availability only; never phone numbers or emails.
      const circle = await this.prisma.careMembership.findMany({
        where: { patientId, revokedAt: null },
        orderBy: { joinedAt: 'asc' },
        take: 12,
        select: {
          userId: true,
          role: true,
          user: { select: { name: true, phoneNumberVerified: true } },
        },
      });
      const people = circle.map((person) => {
        const personName = ['Kuvos user'].includes(person.user.name.trim())
          ? person.role === 'PATIENT'
            ? member.patient.name
            : 'Name not provided'
          : person.user.name.trim();
        return `${personName} (${person.role === 'PATIENT' ? 'patient' : 'caregiver'}${person.userId === userId ? ', the signed-in person' : ''}${person.role === 'CAREGIVER' && person.user.phoneNumberVerified && person.userId !== userId ? ', can be called from Get help' : ''})`;
      });
      return {
        facts: [
          {
            id: 'profile:viewer',
            text: `Signed-in person: ${name || 'Name not provided'}. Care role: ${member.role === 'PATIENT' ? 'Patient, managing their own care' : 'Caregiver, helping the patient'}. Patient: ${member.patient.name}. Plan timezone: ${member.patient.timezone}. Care Circle: ${people.join('; ') || 'no other members'}.`,
            links: [],
          },
        ],
        note: 'The signed-in person is the one talking to you. Use their known name naturally; never confuse a caregiver with the patient. Profile names and care roles are nonclinical identity metadata, not clinical instructions.',
      };
    }
    if (call.name === 'get_help') return { facts: [], note: adviceText };
    if (call.name === 'get_adherence') {
      const rhythm = await rhythmFor(this.prisma, patientId);
      const week = rhythm.days.slice(-7);
      const sum = (key: 'total' | 'done' | 'skipped' | 'missed') =>
        week.reduce((total, day) => total + day[key], 0);
      const label = (day: string) =>
        new Intl.DateTimeFormat('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: 'UTC',
        }).format(new Date(`${day}T12:00:00Z`));
      return {
        facts: [
          {
            id: `rhythm:${week.at(-1)!.day}`,
            text: `Recorded check-ins, last 7 days (${rhythm.timezone}): ${sum('done')} of ${sum('total')} recorded done; ${sum('skipped')} explicitly skipped; ${sum('missed')} windows closed without a check-in.\n${week
              .map((day) =>
                day.total
                  ? `${label(day.day)}: ${day.done} of ${day.total} done${day.skipped ? `, ${day.skipped} skipped` : ''}${day.missed ? `, ${day.missed} closed without a check-in` : ''}`
                  : `${label(day.day)}: nothing scheduled`,
              )
              .join(
                '\n',
              )}\n${rhythm.recordedDays} of the last 28 days had a check-in. Check-ins record activity, not verified treatment.`,
            links: [{ label: 'View Rhythm', kind: 'rhythm' }],
            chart: { kind: 'rhythm', days: week },
          },
        ],
        note: 'Recorded activity only; do not judge health or adherence quality.',
      };
    }
    if (call.name === 'get_exercise') {
      const items = await this.prisma.planItem.findMany({
        where: {
          plan: { patientId, status: 'ACTIVE' },
          physio: { not: Prisma.DbNull },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
        select: { id: true, instructionText: true, physio: true },
      });
      const query = call.query.trim().toLowerCase();
      const facts: ChatEvidence[] = items.flatMap((item) => {
        const physio = object(item.physio);
        const exercise = physioCatalogue.exercises.find(
          (entry) => entry.id === physio.exercise_id,
        );
        if (
          !exercise ||
          (query &&
            !exercise.name.toLowerCase().includes(query) &&
            !item.instructionText.toLowerCase().includes(query))
        )
          return [];
        const { form } = exercise;
        const list = (values: readonly string[] | undefined) =>
          values?.length ? values.map((value) => `• ${value}`).join('\n') : '';
        // Library "easier/harder" holds are prototype defaults, never shown as a dose.
        const sections = [
          form.start && `Starting position: ${form.start}`,
          form.cues?.length && `How to do it:\n${list(form.cues)}`,
          form.breathe && `Breathing: ${form.breathe}`,
          form.faults?.length && `Common mistakes:\n${list(form.faults)}`,
          exercise.precautions?.length &&
            `Precautions:\n${list(exercise.precautions)}`,
          exercise.supports?.length &&
            `You may need:\n${list(exercise.supports.map((support) => support.label))}`,
        ].filter(Boolean);
        return [
          {
            id: `exercise:${item.id}`,
            text: `${exercise.name}, from the exercise library (version ${physioCatalogue.version}), for your confirmed instruction:\n“${item.instructionText}”${typeof physio.dosage === 'string' && physio.dosage.trim() ? `\nConfirmed dosage: ${physio.dosage.trim()}` : ''}\n\n${sections.join('\n\n')}`,
            links: [
              {
                label: `Open ${exercise.name} demo`,
                kind: 'exercise' as const,
                id: exercise.id,
              },
            ],
          },
        ];
      });
      return {
        facts: facts.slice(0, 3),
        note: facts.length
          ? 'General library guidance linked to confirmed plan items. Do not restate it, change the dose or suggest progressions.'
          : 'No physiotherapy exercise in the confirmed plan matches. The library is only used for exercises in the plan.',
      };
    }
    if (call.name === 'get_memory') {
      const notes = await this.prisma.chatMemory.findMany({
        where: { userId, patientId },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });
      return {
        facts: notes.map((note) => ({
          id: `memory:${note.id}`,
          text: `You asked me to remember (${note.createdAt.toISOString().slice(0, 10)}): “${note.text}”\nYour saved words, not care instructions.`,
          links: [],
        })),
        note: notes.length
          ? 'Private explicit notes; not clinical authority.'
          : 'No saved notes.',
      };
    }
    const source = (item: {
      planId: string;
      extractionId: string;
      candidateId: string;
      physio: unknown;
      evidenceSpanIds: unknown;
    }): ChatReply['links'] =>
      object(item.physio).origin === 'reviewer_added' ||
      !Array.isArray(item.evidenceSpanIds) ||
      !item.evidenceSpanIds.length
        ? [
            {
              label: 'Open plan and reviewer details',
              kind: 'plan',
              id: item.planId,
            },
          ]
        : [
            {
              label: 'View original source',
              kind: 'source',
              id: item.extractionId,
              candidateId: item.candidateId,
            },
          ];
    if (
      call.name === 'get_plans' ||
      call.name === 'find_task' ||
      call.name === 'get_task_history'
    ) {
      const query = call.query.trim();
      if (call.name !== 'get_plans' && !query)
        return { facts: [], note: 'Ask which instruction the person means.' };
      const items = await this.prisma.planItem.findMany({
        where: {
          plan: { patientId, status: 'ACTIVE' },
          ...(call.name !== 'get_plans'
            ? {
                OR: [
                  {
                    instructionText: {
                      contains: query,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    actionText: {
                      contains: query,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'asc' },
        // ponytail: get_plans reads up to 40 items for plan date ranges and shows 20; page by plan if plans grow larger.
        take:
          call.name === 'get_plans' ? 40 : call.name === 'find_task' ? 6 : 3,
        select: {
          id: true,
          instructionText: true,
          planId: true,
          extractionId: true,
          candidateId: true,
          physio: true,
          evidenceSpanIds: true,
          category: true,
          schedule: true,
        },
      });
      const { courses, timezone, today, cutoff } = await this.courses(
        patientId,
        items.map((item) => item.id),
      );
      const course = (item: (typeof items)[number]) =>
        courseText(item, courses.get(item.id), timezone, today);
      const label = (item: (typeof items)[number]) =>
        `Confirmed instruction${object(item.physio).origin === 'reviewer_added' ? ' (added by a reviewer)' : ''}:\n“${item.instructionText}”`;
      if (call.name === 'get_task_history') {
        const exceptions = items.length
          ? await this.prisma.occurrence.findMany({
              where: {
                planItemId: { in: items.map((item) => item.id) },
                OR: [
                  { status: { in: ['SKIPPED', 'MISSED'] } },
                  { status: 'SCHEDULED', scheduledAt: { lt: cutoff } },
                ],
              },
              orderBy: { scheduledAt: 'desc' },
              take: 40,
              select: {
                planItemId: true,
                status: true,
                scheduledAt: true,
                logs: {
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                  select: {
                    reason: true,
                    note: true,
                    actor: { select: { name: true } },
                  },
                },
              },
            })
          : [];
        return {
          facts: items.map((item) => {
            const recent = exceptions
              .filter((entry) => entry.planItemId === item.id)
              .slice(0, 10)
              .map((entry) => {
                const log = entry.logs[0];
                const reason = skipLabel(log?.reason);
                const note = log?.note?.trim();
                return `${dateInZone(entry.scheduledAt, timezone)} ${clock(entry.scheduledAt, timezone)}: ${
                  entry.status === 'SKIPPED'
                    ? `explicitly skipped${reason ? `; reason: ${reason}` : ''}${note ? `; note: “${note}”` : ''}${log?.actor?.name ? `; recorded by ${log.actor.name}` : ''}`
                    : 'window closed without a check-in'
                }`;
              });
            return {
              id: `history:${item.id}`,
              text: `${label(item)}\n${course(item)}\n${
                recent.length
                  ? `Recent skips and closed check-ins, newest first:\n${recent.join('\n')}`
                  : 'No skips or closed check-ins recorded.'
              }`,
              links: source(item),
            };
          }),
          note: items.length
            ? 'Recorded activity for these confirmed instructions. Skip reasons and notes are the person’s own words, not clinical findings; do not judge adherence.'
            : 'No matching confirmed active instruction.',
        };
      }
      const facts: ChatEvidence[] = items
        .slice(0, call.name === 'get_plans' ? 20 : 6)
        .map((item) => ({
          id: `instruction:${item.id}`,
          text: `${label(item)}\n${course(item)}`,
          links: source(item),
        }));
      if (call.name === 'get_plans') {
        const result = await this.workflow.listPlans(userId, patientId);
        const plans = result.plans
          .filter((plan) => plan.status === 'active')
          .slice(0, 8);
        facts.unshift(
          ...plans.map((plan) => {
            const spans = items
              .filter((item) => item.planId === plan.id)
              .flatMap((item) => courses.get(item.id) ?? []);
            const first = spans.length
              ? dateInZone(
                  new Date(Math.min(...spans.map((c) => c.first.getTime()))),
                  timezone,
                )
              : '';
            const last = spans.length
              ? dateInZone(
                  new Date(Math.max(...spans.map((c) => c.last.getTime()))),
                  timezone,
                )
              : '';
            return {
              id: `plan:${plan.id}`,
              text: `Active plan: ${plan.name}. Confirmed ${dateInZone(plan.createdAt, timezone)}.${first ? ` Reminders run from ${first} to ${last}.` : ''}`,
              links: [
                {
                  label: `Open ${plan.name}`,
                  kind: 'plan' as const,
                  id: plan.id,
                },
              ],
            };
          }),
        );
      }
      return {
        facts,
        note: facts.length
          ? `Confirmed active records; today is ${today}. Each instruction lists its generated reminder dates and recorded progress, so future and past days can be answered from these dates or get_day. Do not infer schedules beyond them. Use get_task_history for one instruction's skips and reasons.`
          : 'No matching confirmed active records.',
      };
    }
    if (call.name === 'get_day') {
      const member = await this.access(userId, patientId);
      const today = dateInZone(new Date(), member.patient.timezone);
      const query = call.query.trim().toLowerCase();
      const date =
        query in relativeDays
          ? shiftDate(today, relativeDays[query])
          : DATE_ONLY.test(query) &&
              !Number.isNaN(Date.parse(`${query}T00:00:00Z`))
            ? query
            : undefined;
      if (
        !date ||
        Math.abs(Date.parse(date) - Date.parse(today)) > 400 * 86_400_000
      )
        return {
          facts: [],
          note: `Call get_day with a YYYY-MM-DD date within about a year of today (${today}), or today, tomorrow or yesterday.`,
        };
      const day = await this.workflow.getPatientToday(userId, patientId, date);
      return {
        facts: this.dayFacts(day, date === today),
        note: `Tasks for ${date}; today is ${today}. Ongoing restrictions are in get_today.`,
      };
    }
    const today = await this.workflow.getPatientToday(userId, patientId);
    const next = today.occurrences.find(
      (item) => item.status === 'scheduled' && item.window.state !== 'closed',
    );
    if (call.name === 'get_next_task')
      return {
        facts: next
          ? [this.task(today, next)]
          : [
              {
                id: `next:${today.date}`,
                text: `No remaining timed tasks with an open or upcoming check-in window on ${today.date}.`,
                links: [{ label: 'View Today', kind: 'today' }],
              },
            ],
      };
    const [summary, ...tasks] = this.dayFacts(today, true);
    if (call.name === 'get_completed_tasks')
      return {
        facts: [
          summary,
          ...tasks.filter(
            (_, index) => today.occurrences[index].status !== 'scheduled',
          ),
        ],
      };
    const restrictions: ChatEvidence[] = today.restrictions
      .slice(0, 4)
      .map((item) => ({
        id: `restriction:${item.id}`,
        text: `Confirmed restriction:\n“${item.instructionText}”`,
        links: [
          {
            label: 'View restriction source',
            kind: 'source',
            id: item.extractionId,
            candidateId: item.candidateId,
          },
        ],
      }));
    return {
      facts: [summary, ...tasks, ...restrictions],
      note: `Every task for today (${today.date}) with its recorded status and skip reason${next ? `; the next open or upcoming one is task:${next.id}` : ''}. For other days use get_day; for one task's history use get_task_history. Missing data is not a normal health reading.`,
    };
  }
}
