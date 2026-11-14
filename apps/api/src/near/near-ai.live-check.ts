// Live NEAR AI Cloud check: needs NEARAI_API_KEY and sends only synthetic text.
// Run: pnpm --filter @kuvos-near/api check:near-ai
import { config as loadEnv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { attestedChat } from './near-ai';
import { verifyAiSignature } from './verify-core';

loadEnv({ path: '../../.env' });
const config = new ConfigService(process.env);
const chatModel = process.env.CHAT_MODEL || 'Qwen/Qwen3.6-35B-A3B-FP8';
const noThinking = { chat_template_kwargs: { enable_thinking: false } };

async function run(name: string, body: Record<string, unknown>) {
  const started = Date.now();
  const { completion, attestation } = await attestedChat(
    config,
    { model: chatModel, ...noThinking, ...body },
    name,
  );
  const check = verifyAiSignature(attestation);
  const message = completion.choices[0]?.message ?? {};
  console.log(
    `${check.ok ? 'PASS' : 'FAIL'} ${name} (${Date.now() - started} ms, e2ee=${attestation.e2ee}, tcb=${attestation.tcbStatus ?? '?'})`,
  );
  console.log(
    `  reply: ${JSON.stringify(message.content ?? message.tool_calls).slice(0, 160)}`,
  );
  if (!check.ok) throw new Error(check.detail);
}

async function main() {
  await run('plain chat', {
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
    max_tokens: 20,
  });
  await run('structured output', {
    messages: [
      {
        role: 'user',
        content:
          'Synthetic note: "Walk 10 minutes twice daily." Return the action.',
      },
    ],
    max_tokens: 200,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'action',
        strict: true,
        schema: {
          type: 'object',
          properties: { action: { type: 'string' } },
          required: ['action'],
          additionalProperties: false,
        },
      },
    },
  });
  await run('tool call', {
    messages: [{ role: 'user', content: 'What is on my plan today?' }],
    max_tokens: 200,
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_day',
          description: 'Read the care tasks for one day.',
          parameters: {
            type: 'object',
            properties: { date: { type: 'string' } },
            required: ['date'],
          },
        },
      },
    ],
  });
}

main().catch((error: unknown) => {
  console.error(
    'FAIL',
    error instanceof Error ? error.message.slice(0, 400) : error,
  );
  process.exit(1);
});
