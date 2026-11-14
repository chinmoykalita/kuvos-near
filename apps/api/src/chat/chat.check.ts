import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import type { WorkflowService } from '../workflow.service';
import {
  adviceMessage,
  adviceText,
  chatConsentVersion,
  emergencyMessage,
  messageBody,
  object,
  parseTool,
  unsafeModelMessage,
} from './chat.policy';
import {
  assistantName,
  ChatModel,
  contextHeading,
  replyJson,
} from './chat.model';
import { ChatService } from './chat.service';
import type { NearService } from '../near/near.service';
import { nearAiTransport } from '../near/near-ai';

type Row = {
  id: string;
  userId: string;
  patientId: string;
  requestId?: string;
  text: string;
  reply?: unknown;
  createdAt: Date;
};
type Filter = {
  userId?: string;
  patientId?: string;
  id?: string | { in: string[] };
};
type Request = {
  model: string;
  models?: string[];
  tools?: { function: { name: string } }[];
  tool_choice: string;
  messages: {
    role: string;
    content: string | null;
    tool_calls?: { function: { name: string } }[];
  }[];
};

async function check() {
  for (const text of [
    'I can’t breathe',
    'Chest pain now',
    'I took an overdose',
    'I want to kill myself',
    'My dad is unconscious',
    'heavy bleeding',
  ])
    assert(emergencyMessage(text), text);
  assert(!emergencyMessage('Show my plan'));
  assert(!unsafeModelMessage('You have an active plan.'));
  assert(
    !unsafeModelMessage(
      'Next up is your morning walk at 8 AM, and you skipped your evening medicine yesterday.',
      true,
    ),
    'Grounded replies may name tasks, times and statuses',
  );
  for (const text of [
    'Take your evening tablets at 8 PM.',
    'Your 2 tablets are due at 8 AM.',
    'You should walk more.',
  ])
    assert(unsafeModelMessage(text, true), text);
  for (const text of [
    'Take care, Asha.',
    'Take your time, I’m here.',
    'Enjoy the rest of your day.',
    'Sleep well tonight.',
    'That comes to roughly 25 g of protein and about 420 kcal.',
    'Two cheela give around 14 g, the buttermilk about 3 g and the peanut butter about 4 g.',
    'Want to try again?',
  ])
    assert(!unsafeModelMessage(text), text);
  for (const text of [
    'Should I take two?',
    'Can I mix medicines?',
    'I feel unwell',
    'Is my fever normal?',
  ])
    assert(adviceMessage(text), text);
  for (const text of [
    'Take double your dose.',
    'This is safe.',
    'You probably have diabetes.',
    'Your next task is at 8.',
    'Take care to rest your knee.',
    'Try some rest.',
    'Your walk is due at 7:30.',
    'Your reminder is 8 pm.',
    'That is 500mg.',
  ])
    assert(unsafeModelMessage(text), text);
  assert.throws(() => messageBody({ text: 'hi', requestId: 'bad' }));
  assert.throws(() =>
    messageBody({ text: 'x'.repeat(2001), requestId: randomUUID() }),
  );
  assert.equal(
    parseTool({ function: { name: 'delete_patient', arguments: '{}' } }),
    undefined,
  );
  assert.equal(
    parseTool({ function: { name: 'get_today', arguments: 'not json' } }),
    undefined,
  );
  const draft = { kind: 'answer', message: 'Hi', evidenceIds: [] };
  for (const content of [
    JSON.stringify(draft),
    '```json\n' + JSON.stringify(draft) + '\n```',
    [{ type: 'text', text: JSON.stringify(draft) }],
  ])
    assert.deepEqual(replyJson(content), draft);
  for (const content of ['', null, 'Hello there', '[]', '{}'])
    assert.equal(replyJson(content), undefined);

  const turns: Row[] = [],
    notes: Row[] = [],
    requests: Request[] = [];
  let revoked = false,
    version: string | null = chatConsentVersion;
  let careRole: 'PATIENT' | 'CAREGIVER' = 'PATIENT';
  let viewerName = 'Synthetic account';
  const requestedDates: (string | undefined)[] = [];
  let providerCalls = 0,
    toolCalls = 0;
  let duringProvider: (() => void) | undefined;
  let scenario:
    | 'normal'
    | 'tools'
    | 'memory'
    | 'profile'
    | 'adherence'
    | 'exercise'
    | 'day'
    | 'history'
    | 'unsafe'
    | 'unsafeRecords'
    | 'feeling'
    | 'feelingUnsafe'
    | 'forged'
    | 'failure'
    | 'invalid' = 'normal';
  const originalFetch = globalThis.fetch;
  const response = (
    message: string,
    evidenceIds: string[] = [],
    extra: Record<string, unknown> = {},
  ) =>
    new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'final-reply',
                  type: 'function',
                  function: {
                    name: 'reply',
                    arguments: JSON.stringify({
                      kind: 'answer',
                      message,
                      evidenceIds,
                      ...extra,
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  // The NEAR AI SDK transport is replaced by the synthetic provider below plus a fake TEE proof.
  nearAiTransport.chat = async (_config, body, purpose) => {
    const res = await globalThis.fetch(
      'https://cloud-api.near.ai/v1/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw new Error('provider response');
    const payload = (await res.json()) as {
      choices: { finish_reason?: string; message: Record<string, unknown> }[];
    };
    return {
      completion: {
        id: randomUUID(),
        model: body.model,
        choices: payload.choices,
      },
      attestation: {
        provider: 'near-ai-cloud',
        purpose,
        model: body.model,
        completionId: 'synthetic',
        signatureKind: 'provider_tee',
        signedText: 'synthetic',
        signature: 'synthetic',
        signingAlgo: 'ed25519',
        signingAddress: 'synthetic',
        e2ee: true,
        verifiedAt: new Date(0).toISOString(),
      },
    };
  };
  globalThis.fetch = (_url, options) => {
    providerCalls++;
    assert.equal(typeof options?.body, 'string');
    const sent = JSON.parse(options?.body as string) as Request;
    requests.push(sent);
    assert(sent.messages[0].content?.startsWith(`You are ${assistantName},`));
    assert.equal(sent.model, 'synthetic-model');
    assert(
      sent.tools?.some((tool) => tool.function.name === 'reply') &&
        !sent.tools.some((tool) => tool.function.name === 'get_help'),
      'Advice requests use reply kind=boundary; get_help is not offered',
    );
    assert(
      !Object.hasOwn(sent, 'parallel_tool_calls'),
      'Only provider-supported parameters should be sent',
    );
    assert(
      !Object.hasOwn(sent, 'response_format') &&
        sent.tool_choice === 'required',
      'Final replies arrive through the forced reply tool, not JSON response mode',
    );
    assert(!JSON.stringify(sent).includes('other-author-secret'));
    assert(!JSON.stringify(sent).includes('other-patient-secret'));
    duringProvider?.();
    if (scenario === 'failure')
      return Promise.resolve(new Response('Unavailable', { status: 503 }));
    if (scenario === 'invalid')
      return Promise.resolve(new Response('not-json'));
    if (
      scenario === 'tools' &&
      !sent.messages.some((message) =>
        message.tool_calls?.some((call) => call.function.name === 'find_task'),
      )
    ) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      id: 'lookup-plans',
                      type: 'function',
                      function: {
                        name: 'find_task',
                        arguments: '{"query":"Synthetic"}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        ),
      );
    }
    const lookup =
      scenario === 'adherence'
        ? { name: 'get_adherence', query: '', prefix: 'rhythm:' }
        : scenario === 'exercise'
          ? { name: 'get_exercise', query: 'quad', prefix: 'exercise:' }
          : scenario === 'day'
            ? { name: 'get_day', query: 'tomorrow', prefix: 'task:' }
            : scenario === 'history'
              ? {
                  name: 'get_task_history',
                  query: 'walking',
                  prefix: 'history:',
                }
              : undefined;
    if (lookup) {
      if (
        !sent.messages.some((message) =>
          message.tool_calls?.some(
            (call) => call.function.name === lookup.name,
          ),
        )
      )
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    tool_calls: [
                      {
                        id: `lookup-${lookup.name}`,
                        type: 'function',
                        function: {
                          name: lookup.name,
                          arguments: JSON.stringify({ query: lookup.query }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          ),
        );
      const found = sent.messages
        .filter((message) => message.role === 'tool')
        .flatMap((message) =>
          (
            JSON.parse(message.content!) as { facts: { id: string }[] }
          ).facts.map((fact) => fact.id),
        )
        .filter((id) => id.startsWith(lookup.prefix));
      return Promise.resolve(response('Here it is.', found));
    }
    if (scenario === 'unsafe')
      return Promise.resolve(response('Take double your dose.'));
    if (scenario === 'feeling')
      return Promise.resolve(
        response('Thanks for telling me. That sounds like a hard week.', [], {
          kind: 'boundary',
        }),
      );
    if (scenario === 'feelingUnsafe')
      return Promise.resolve(
        response('You should rest.', [], { kind: 'boundary' }),
      );
    if (scenario === 'unsafeRecords')
      return Promise.resolve(
        response('Next, take your 8 AM medicine.', ['today:2026-10-29']),
      );
    if (scenario === 'profile')
      return Promise.resolve(response('I’m Tomo.', ['profile:viewer']));
    if (scenario === 'forged')
      return Promise.resolve(response('Here is the entry.', ['task:invented']));
    if (scenario === 'memory') {
      const preloaded = JSON.parse(
        sent.messages[0].content!.split(`${contextHeading}\n`)[1],
      ) as Record<string, { facts: { id: string }[] }>;
      const ids = Object.values(preloaded)
        .flatMap((result) => result.facts.map((fact) => fact.id))
        .filter((id) => id.startsWith('memory:'));
      return Promise.resolve(
        response('Here is your note: private-note-value.', ids.slice(0, 1)),
      );
    }
    return Promise.resolve(
      response('I’m here with you. Here is your current record.', [
        scenario === 'tools' ? 'plan:plan' : 'today:2026-10-29',
      ]),
    );
  };
  const scoped = (where: Filter, rows: Row[]) =>
    rows.filter(
      (row) =>
        (!where.userId || row.userId === where.userId) &&
        (!where.patientId || row.patientId === where.patientId) &&
        (!where.id ||
          (typeof where.id === 'string'
            ? row.id === where.id
            : where.id.in.includes(row.id))),
    );
  const database = {
    careMembership: {
      findFirst: ({
        where,
      }: {
        where: { userId: string; patientId: string };
      }) =>
        where.userId === 'owner' && where.patientId === 'patient' && !revoked
          ? {
              role: careRole,
              patient: { name: 'Synthetic patient', timezone: 'Asia/Kolkata' },
              user: {
                name: viewerName,
                chatProcessingConsentedAt: new Date(),
                chatProcessingConsentVersion: version,
              },
            }
          : null,
      // Contact lookups filter on CAREGIVER; the Care Circle summary lists everyone.
      findMany: ({ where }: { where: { patientId: string; role?: string } }) =>
        where.role
          ? []
          : [
              {
                userId: 'owner',
                role: careRole,
                user: { name: viewerName, phoneNumberVerified: false },
              },
              {
                userId: 'helper',
                role: 'CAREGIVER',
                user: { name: 'Synthetic helper', phoneNumberVerified: true },
              },
            ],
    },
    patientProfile: {
      findUniqueOrThrow: () => ({
        timezone: 'Asia/Kolkata',
        markCloseAfterMinutes: 180,
      }),
    },
    occurrence: {
      findMany: ({ where }: { where: { OR?: unknown } }) =>
        [
          {
            planItemId: 'item',
            status: 'DONE',
            scheduledAt: new Date(Date.now() - 86_400_000),
            logs: [],
          },
          {
            planItemId: 'item',
            status: 'SKIPPED',
            scheduledAt: new Date(Date.now() - 86_400_000),
            logs: [
              {
                reason: 'no_medicines',
                note: 'Ran out',
                actor: { name: 'Synthetic helper' },
              },
            ],
          },
        ].filter((row) => !where.OR || row.status === 'SKIPPED'),
      // A five-day course: yesterday one done and one skipped, two still ahead.
      groupBy: ({
        by,
        where,
      }: {
        by: string[];
        where: { scheduledAt?: { lt?: Date } };
      }) =>
        by.length === 1
          ? [
              {
                planItemId: 'item',
                _min: { scheduledAt: new Date(Date.now() - 2 * 86_400_000) },
                _max: { scheduledAt: new Date(Date.now() + 2 * 86_400_000) },
              },
            ]
          : where.scheduledAt?.lt
            ? [
                { planItemId: 'item', status: 'DONE', _count: { _all: 1 } },
                { planItemId: 'item', status: 'SKIPPED', _count: { _all: 1 } },
              ]
            : [
                {
                  planItemId: 'item',
                  status: 'SCHEDULED',
                  _count: { _all: 2 },
                },
              ],
    },
    user: {
      update: ({
        data,
      }: {
        data: { chatProcessingConsentVersion: string | null };
      }) => {
        version = data.chatProcessingConsentVersion;
        return {};
      },
    },
    chatTurn: {
      findFirst: ({ where }: { where: Filter }) =>
        scoped(where, turns)
          .filter((row) => object(row.reply).contextReset === true)
          .at(-1) ?? null,
      upsert: ({ create }: { create: Omit<Row, 'id' | 'createdAt'> }) => {
        const row = { ...create, id: randomUUID(), createdAt: new Date() };
        turns.push(row);
        return row;
      },
      findUnique: ({
        where,
      }: {
        where: {
          userId_patientId_requestId: {
            userId: string;
            patientId: string;
            requestId: string;
          };
        };
      }) =>
        turns.find(
          (row) =>
            row.userId === where.userId_patientId_requestId.userId &&
            row.patientId === where.userId_patientId_requestId.patientId &&
            row.requestId === where.userId_patientId_requestId.requestId,
        ) ?? null,
      findMany: ({ where }: { where: Filter }) =>
        scoped(where, turns).slice().reverse(),
      count: () => turns.length,
      create: ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
        const row = { ...data, id: randomUUID(), createdAt: new Date() };
        turns.push(row);
        return row;
      },
      deleteMany: ({ where }: { where: Filter }) => {
        scoped(where, turns).forEach((row) =>
          turns.splice(turns.indexOf(row), 1),
        );
      },
    },
    chatMemory: {
      findMany: ({ where }: { where: Filter }) => scoped(where, notes),
      count: ({ where }: { where: Filter }) => scoped(where, notes).length,
      create: ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
        const row = { ...data, id: randomUUID(), createdAt: new Date() };
        notes.push(row);
        return row;
      },
      deleteMany: ({ where }: { where: Filter }) => {
        const matched = scoped(where, notes);
        matched.forEach((row) => notes.splice(notes.indexOf(row), 1));
        return { count: matched.length };
      },
    },
    planItem: {
      findMany: ({
        where,
      }: {
        where: { plan: { patientId: string }; physio?: unknown };
      }) => {
        assert.equal(where.plan.patientId, 'patient');
        return where.physio
          ? [
              {
                id: 'physio-item',
                instructionText: 'Synthetic quad sets as instructed',
                physio: {
                  exercise_id: 'knee-quad-set',
                  origin: 'document_match',
                },
              },
            ]
          : [
              {
                id: 'item',
                instructionText: 'Synthetic walking task',
                planId: 'plan',
                extractionId: 'extraction',
                candidateId: 'candidate',
                physio: null,
                evidenceSpanIds: ['span'],
                category: 'exercise',
                schedule: {
                  kind: 'times_per_day',
                  times: ['08:00'],
                  duration_days: 5,
                },
              },
            ];
      },
    },
    $transaction: <T>(run: (db: unknown) => Promise<T>) => run(database),
  };
  const workflow = {
    listPlans: () => ({
      plans: [
        {
          id: 'plan',
          name: 'Synthetic active plan',
          status: 'active',
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        },
      ],
    }),
    getPatientToday: (_userId: string, _patientId: string, date?: string) => {
      toolCalls++;
      requestedDates.push(date);
      return {
        date: date ?? '2026-10-29',
        timezone: 'Asia/Kolkata',
        restrictions: [],
        occurrences: [
          {
            id: 'done',
            actionText: 'Recorded exercise',
            instructionText: 'Synthetic confirmed source instruction',
            scheduledAt: new Date('2026-10-29T02:30:00Z'),
            status: 'done',
            window: { state: 'closed' },
            planId: 'plan',
          },
          {
            id: 'next',
            actionText: 'Confirmed care task',
            instructionText: 'Synthetic source-backed care task',
            scheduledAt: new Date('2026-10-29T12:30:00Z'),
            status: 'scheduled',
            window: { state: 'upcoming' },
            planId: 'plan',
          },
        ],
      };
    },
  };
  const config = new ConfigService({
    CHAT_PROCESSING_APPROVED: 'true',
    CHAT_MODEL: 'synthetic-model',
    NEARAI_API_KEY: 'synthetic-key',
  });
  const service = new ChatService(
    database as unknown as PrismaService,
    workflow as unknown as WorkflowService,
    new ChatModel(config),
    {
      gateDecision: () => Promise.resolve(null),
    } as unknown as NearService,
  );
  const send = (text: string, requestId = randomUUID()) =>
    service.send('owner', 'patient', { text, requestId });
  try {
    await assert.rejects(service.state('other', 'patient'), NotFoundException);
    await assert.rejects(
      service.send('owner', 'other-patient', {
        text: 'Show today',
        requestId: randomUUID(),
      }),
      NotFoundException,
    );
    assert.equal((await send('I have chest pain')).reply && providerCalls, 0);
    assert.equal(toolCalls, 0);
    assert.equal(
      (await send('Should I take double my dose?')).reply && providerCalls,
      0,
    );
    const requestId = randomUUID();
    const saved = await send('Remember that private-note-value', requestId);
    assert.equal(notes.length, 1);
    assert.equal(
      (await send('Remember that private-note-value', requestId)).id,
      saved.id,
    );
    assert.equal(notes.length, 1);
    await assert.rejects(send('Remember that'));
    await assert.rejects(send('Different text', requestId));
    const current = await send('How is my day going?');
    const preloaded = requests[0].messages[0];
    assert.equal(preloaded.role, 'system');
    assert.equal(
      requests[0].messages.filter((message) => message.role === 'system')
        .length,
      1,
    );
    assert(preloaded.content?.includes(`\n\n${contextHeading}\n`));
    assert.deepEqual(
      Object.keys(
        JSON.parse(
          preloaded.content!.split(`${contextHeading}\n`)[1],
        ) as object,
      ),
      ['get_profile', 'get_today', 'get_plans', 'get_memory', 'get_adherence'],
    );
    assert.deepEqual(
      requests[0].messages.at(-1),
      { role: 'user', content: 'How is my day going?' },
      'The latest message must be the last thing the model reads',
    );
    const initialContext = JSON.stringify(preloaded);
    assert(initialContext.includes('Signed-in person: Synthetic account'));
    assert(initialContext.includes('Patient, managing their own care'));
    assert(initialContext.includes('Patient: Synthetic patient'));
    assert(initialContext.includes('Synthetic active plan'));
    assert(
      initialContext.includes('Reminders at 08:00, from') &&
        initialContext.includes('(5 days)') &&
        initialContext.includes('Today is day 3 of 5.') &&
        initialContext.includes(
          'Recorded so far: 1 done, 1 explicitly skipped, 0 closed without a check-in; 2 still ahead or not checked yet.',
        ),
      'Preloaded instructions carry their course dates and recorded progress',
    );
    assert(
      initialContext.includes('Synthetic source-backed care task') &&
        initialContext.includes('Synthetic confirmed source instruction'),
      'Today lists every task, not only the next one',
    );
    assert(initialContext.includes('rhythm:'), 'Adherence is preloaded');
    assert(
      initialContext.includes(
        'Synthetic helper (caregiver, can be called from Get help)',
      ),
      'The profile lists Care Circle names, roles and call availability',
    );
    assert.equal(
      (current.reply as { text: string }).text,
      'I’m here with you. Here is your current record.',
      'Grounded replies show the message, not a pasted record',
    );
    assert.deepEqual((current.reply as { evidenceIds: string[] }).evidenceIds, [
      'today:2026-10-29',
    ]);
    assert.equal(
      (current.reply as { message: string }).message,
      'I’m here with you. Here is your current record.',
    );
    assert(preloaded.content?.includes('private-note-value'));
    notes.push({
      id: randomUUID(),
      userId: 'other',
      patientId: 'patient',
      text: 'other-author-secret',
      createdAt: new Date(),
    });
    notes.push({
      id: randomUUID(),
      userId: 'owner',
      patientId: 'other',
      text: 'other-patient-secret',
      createdAt: new Date(),
    });
    scenario = 'tools';
    const plans = await send('Which care folders are active?');
    assert(
      (plans.reply as { links: { label: string }[] }).links.some(
        (link) => link.label === 'Open Synthetic active plan',
      ),
    );
    assert.equal(requests.at(-1)!.messages.at(-1)!.role, 'tool');
    assert(
      requests
        .at(-1)!
        .messages.some((message) =>
          message.tool_calls?.some(
            (call) => call.function.name === 'find_task',
          ),
        ),
    );
    careRole = 'CAREGIVER';
    scenario = 'normal';
    await send('Who am I helping?');
    const caregiverContext = JSON.stringify(requests.at(-1)!.messages[0]);
    assert(caregiverContext.includes('Signed-in person: Synthetic account'));
    assert(caregiverContext.includes('Caregiver, helping the patient'));
    assert(caregiverContext.includes('Patient: Synthetic patient'));
    careRole = 'PATIENT';
    viewerName = 'Kuvos user';
    await send('Hi');
    const selfContext = JSON.stringify(requests.at(-1)!.messages[0]);
    assert(
      selfContext.includes('Signed-in person: Synthetic patient'),
      'Self-managing patients can use their patient name when the account name is a placeholder',
    );
    viewerName = 'Synthetic account';
    assert(
      requests
        .at(-1)!
        .messages.some(
          (message) =>
            message.role === 'assistant' &&
            message.content?.includes('I’m here with you'),
        ),
    );
    scenario = 'profile';
    const named = (await send('What is your name?')).reply as {
      text: string;
      evidenceIds: string[];
    };
    assert.equal(
      named.text,
      'I’m Tomo.',
      'Profile identity is model context, never a displayed record',
    );
    assert.deepEqual(named.evidenceIds, []);
    scenario = 'adherence';
    const adherence = (await send('How has my week gone?')).reply as {
      text: string;
      links: { kind: string }[];
      chart?: { kind: string; days: { done: number }[] };
    };
    assert.equal(adherence.chart?.kind, 'rhythm');
    assert.equal(adherence.chart?.days.length, 7);
    assert.equal(
      adherence.chart?.days.reduce((total, day) => total + day.done, 0),
      1,
    );
    assert(
      JSON.stringify(requests.at(-1)!.messages).includes(
        '1 of 2 recorded done; 1 explicitly skipped',
      ),
    );
    assert.equal(adherence.text, 'Here it is.');
    assert(adherence.links.some((link) => link.kind === 'rhythm'));
    scenario = 'day';
    const tomorrow = (await send('What do I have tomorrow?')).reply as {
      text: string;
      links: { kind: string; date?: string }[];
    };
    const dayContext = JSON.stringify(requests.at(-1)!.messages);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(requestedDates.at(-1) ?? ''));
    assert(dayContext.includes(`Confirmed task for ${requestedDates.at(-1)}`));
    assert(dayContext.includes('Recorded status: upcoming'));
    assert.equal(tomorrow.text, 'Here it is.');
    assert(
      tomorrow.links.some(
        (link) => link.kind === 'task' && link.date === requestedDates.at(-1),
      ),
    );
    scenario = 'history';
    await send('How has my walking gone?');
    const historyContext = JSON.stringify(requests.at(-1)!.messages);
    assert(historyContext.includes('Synthetic walking task'));
    assert(
      historyContext.includes(
        'explicitly skipped; reason: No medicines; note: “Ran out”; recorded by Synthetic helper',
      ),
    );
    // The fake rate limit counts every turn; drop these two so later checks keep their budget.
    turns.splice(-2);
    scenario = 'exercise';
    const exercise = (await send('How do I do quad sets?')).reply as {
      text: string;
      links: { kind: string; id?: string }[];
    };
    assert(exercise.text.includes('Quad set, from the exercise library'));
    assert(exercise.text.includes('Starting position: Lie on your back'));
    assert(exercise.text.includes('Synthetic quad sets as instructed'));
    assert(
      !exercise.text.includes('Hold for 2 to 3 seconds'),
      'Library easier/harder defaults are never shown as a dose',
    );
    assert.deepEqual(
      exercise.links.map((link) => [link.kind, link.id]),
      [['exercise', 'knee-quad-set']],
    );
    scenario = 'unsafe';
    const unsafe = await send('Show me my record');
    // Filtered wording without records is withheld, not mislabelled as an advice request.
    assert.equal((unsafe.reply as { kind: string }).kind, 'answer');
    assert(!(unsafe.reply as { text: string }).text.includes('Take double'));
    assert(!(unsafe.reply as { text: string }).text.includes('medical advice'));
    scenario = 'unsafeRecords';
    const records = (await send('What is next on my list?')).reply as {
      kind: string;
      text: string;
      message: string;
    };
    assert.equal(records.kind, 'answer');
    assert.equal(records.message, 'Here you go.');
    scenario = 'feeling';
    const feeling = (await send('I have been feeling low this week')).reply as {
      kind: string;
      text: string;
    };
    assert.equal(feeling.kind, 'boundary');
    assert.equal(
      feeling.text,
      'Thanks for telling me. That sounds like a hard week.',
      'Tomo keeps its own boundary wording when it passes the filter',
    );
    assert(!('noteOffer' in feeling), 'Replies no longer offer a save button');
    scenario = 'feelingUnsafe';
    const unsafeFeeling = (await send('I feel tired')).reply as {
      text: string;
    };
    assert.equal(unsafeFeeling.text, adviceText);
    const calls = providerCalls;
    const precheck = (await send('Is my knee pain normal?')).reply as {
      kind: string;
    };
    assert.equal(
      providerCalls,
      calls,
      'Advice wording never reaches the model',
    );
    assert.equal(precheck.kind, 'boundary');
    const noteCount = notes.length;
    await send('Remember that Is my knee pain normal?');
    assert.equal(
      notes.length,
      noteCount + 1,
      'A note about a symptom is saved, not refused as advice',
    );
    assert.equal(notes.at(-1)?.text, 'Is my knee pain normal?');
    assert(!records.text.includes('8 AM medicine'));
    for (const invalid of ['forged', 'failure', 'invalid'] as const) {
      scenario = invalid;
      const count = turns.length;
      await assert.rejects(
        send('Show my current day'),
        ServiceUnavailableException,
      );
      assert.equal(
        turns.length,
        count,
        'Provider failures must not turn into canned successful messages',
      );
    }
    scenario = 'memory';
    await send('What did I ask you to remember?');
    const noteId = notes[0].id;
    await service.forget('owner', 'patient', noteId);
    scenario = 'normal';
    await send('Hello again');
    assert(
      !JSON.stringify(requests.at(-1)).includes('private-note-value'),
      'Forgotten note must not re-enter from old commands or excerpts',
    );
    const before = providerCalls;
    config.set('CHAT_PROCESSING_APPROVED', 'false');
    await assert.rejects(send('What is next?'), ServiceUnavailableException);
    assert.equal(providerCalls, before);
    config.set('CHAT_PROCESSING_APPROVED', 'true');
    version = null;
    assert.equal(
      (await service.state('owner', 'patient')).connectionStatus,
      'consent_required',
    );
    await assert.rejects(send('Hello'), ForbiddenException);
    await assert.rejects(service.consent('owner', { accepted: true }));
    await service.consent('owner', {
      accepted: true,
      version: chatConsentVersion,
    });
    assert.equal(
      (await service.state('owner', 'patient')).connectionStatus,
      'ready',
    );
    duringProvider = () => {
      revoked = true;
    };
    const count = turns.length;
    await assert.rejects(send('Read today'), NotFoundException);
    assert.equal(turns.length, count);
    revoked = false;
    duringProvider = undefined;
    config.set('NEARAI_API_KEY', '');
    await assert.rejects(send('Hello'), ServiceUnavailableException);
    assert.equal(
      (await service.state('owner', 'patient')).connectionStatus,
      'not_configured',
    );
    await service.clear('owner', 'patient');
    assert.equal(turns.length, 0);
    console.log(
      'Chat checks passed: real model/tool round trip, scoped context and history, exact evidence, no canned fallback, renewed consent, forgetting, access revocation and emergency priority.',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}
void check();
