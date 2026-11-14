import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { PrismaService } from '../database/prisma.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { chatConsentVersion } from './chat.policy';
import {
  audioFormat,
  ChatTranscriptionService,
  dictationConsentVersion,
  maxAudioBytes,
  type AudioUpload,
} from './chat-transcription.service';

function wav(): AudioUpload {
  const buffer = Buffer.alloc(364);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(320, 40);
  return { buffer, mimetype: 'audio/wav', size: buffer.length };
}
async function check() {
  const userId = randomUUID(),
    patientId = randomUUID();
  let allowed = true,
    consented = true,
    revokeDuringRequest = false,
    calls = 0;
  let mode: 'ok' | 'fail' | 'empty' | 'invalid' | 'long' = 'ok';
  const write = () => {
    throw new Error('Transcription must not persist anything');
  };
  const database = {
    careMembership: {
      findFirst: ({
        where,
      }: {
        where: { userId: string; patientId: string; revokedAt: null };
      }) => {
        assert.equal(where.revokedAt, null);
        return allowed &&
          where.userId === userId &&
          where.patientId === patientId
          ? {
              user: {
                chatProcessingConsentedAt: consented ? new Date() : null,
                chatProcessingConsentVersion: chatConsentVersion,
              },
            }
          : null;
      },
    },
    chatTurn: { create: write, upsert: write },
    chatMemory: { create: write },
    document: { create: write },
    $transaction: write,
  };
  const config = new ConfigService({
    CHAT_PROCESSING_APPROVED: 'true',
    NEARAI_API_KEY: 'synthetic-key',
  });
  const create = () =>
    new ChatTranscriptionService(database as unknown as PrismaService, config);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (url !== 'https://cloud-api.near.ai/v1/audio/transcriptions')
      return nativeFetch(url, init);
    calls++;
    assert(init?.body instanceof FormData);
    const form = init.body;
    assert.equal(form.get('model'), 'openai/whisper-large-v3');
    const file = form.get('file');
    assert(file instanceof Blob);
    assert.equal(
      Buffer.from(await file.arrayBuffer()).toString('ascii', 0, 4),
      'RIFF',
    );
    for (const key of ['messages', 'user', 'session_id', 'trace'])
      assert(!form.has(key));
    if (revokeDuringRequest) allowed = false;
    return Promise.resolve(
      mode === 'fail'
        ? new Response('provider failure', { status: 503 })
        : mode === 'invalid'
          ? new Response('invalid-json')
          : new Response(
              JSON.stringify({
                text:
                  mode === 'empty'
                    ? ''
                    : mode === 'long'
                      ? 'x'.repeat(2001)
                      : '  Show my next task.  ',
                usage: { seconds: 1 },
              }),
            ),
    );
  };
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    assert.throws(() => audioFormat());
    assert.throws(() =>
      audioFormat({
        buffer: Buffer.alloc(20),
        size: 20,
        mimetype: 'audio/wav',
      }),
    );
    assert.throws(() =>
      audioFormat({
        buffer: Buffer.alloc(maxAudioBytes + 1),
        size: maxAudioBytes + 1,
        mimetype: 'audio/wav',
      }),
    );
    const m4a = Buffer.alloc(24);
    m4a.writeUInt32BE(24);
    m4a.write('ftyp', 4);
    m4a.write('M4A ', 8);
    assert.equal(
      audioFormat({ buffer: m4a, size: 24, mimetype: 'audio/mp4' }),
      'm4a',
    );
    const service = create(),
      audio = wav();
    assert.deepEqual(
      await service.transcribe(
        userId,
        patientId,
        dictationConsentVersion,
        audio,
      ),
      { text: 'Show my next task.' },
    );
    assert(audio.buffer.every((byte) => byte === 0));
    for (const variant of [
      'member',
      'consent',
      'header',
      'disabled',
    ] as const) {
      const before = calls,
        input = wav();
      if (variant === 'member') allowed = false;
      if (variant === 'consent') consented = false;
      if (variant === 'disabled')
        config.set('CHAT_PROCESSING_APPROVED', 'false');
      await assert.rejects(
        service.transcribe(
          userId,
          patientId,
          variant === 'header' ? undefined : dictationConsentVersion,
          input,
        ),
      );
      assert.equal(calls, before);
      assert(input.buffer.every((byte) => byte === 0));
      allowed = true;
      consented = true;
      config.set('CHAT_PROCESSING_APPROVED', 'true');
    }
    for (const failure of ['fail', 'empty', 'invalid', 'long'] as const) {
      mode = failure;
      const input = wav();
      await assert.rejects(
        create().transcribe(userId, patientId, dictationConsentVersion, input),
      );
      assert(input.buffer.every((byte) => byte === 0));
    }
    mode = 'ok';
    revokeDuringRequest = true;
    await assert.rejects(
      create().transcribe(userId, patientId, dictationConsentVersion, wav()),
    );
    allowed = true;
    revokeDuringRequest = false;
    const limited = create();
    for (let i = 0; i < 6; i++)
      await limited.transcribe(
        userId,
        patientId,
        dictationConsentVersion,
        wav(),
      );
    const before = calls;
    await assert.rejects(
      limited.transcribe(userId, patientId, dictationConsentVersion, wav()),
    );
    assert.equal(calls, before);
    const httpService = create(),
      buffers: Buffer[] = [];
    const transcribe = httpService.transcribe.bind(httpService);
    httpService.transcribe = (actor, patient, consent, input) => {
      if (input) {
        assert(
          !Object.hasOwn(input, 'path'),
          'Upload must be in memory, not on disk',
        );
        buffers.push(input.buffer);
      }
      return transcribe(actor, patient, consent, input);
    };
    class TestModule {}
    Module({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: {} },
        { provide: ChatTranscriptionService, useValue: httpService },
      ],
    })(TestModule);
    app = await NestFactory.create(TestModule, { logger: false });
    // Synthetic session shim; production uses the existing global Better Auth guard.
    app.use((req: { session?: unknown }, _res: unknown, next: () => void) => {
      req.session = { user: { id: userId } };
      next();
    });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const url = `${await app.getUrl()}/api/patients/${patientId}/chat/transcription`;
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(wav().buffer)], { type: 'audio/wav' }),
      'voice.wav',
    );
    const response = await nativeFetch(url, {
      method: 'POST',
      headers: { 'X-Dictation-Consent': dictationConsentVersion },
      body: form,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, private');
    assert.deepEqual(await response.json(), { text: 'Show my next task.' });
    assert(buffers[0].every((byte) => byte === 0));
    const large = new FormData();
    large.append(
      'audio',
      new Blob([new Uint8Array(maxAudioBytes + 1)], { type: 'audio/wav' }),
      'large.wav',
    );
    const oversized = await nativeFetch(url, {
      method: 'POST',
      headers: { 'X-Dictation-Consent': dictationConsentVersion },
      body: large,
    });
    assert.equal(oversized.status, 413);
    console.log(
      'Transcription checks passed: multipart endpoint, memory-only upload, byte validation, scoped access/consent, NEAR AI TEE request, no persistence, cleanup, no-cache, provider errors and rate limit.',
    );
  } finally {
    globalThis.fetch = nativeFetch;
    if (app) await app.close();
  }
}
void check();
