import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { chatConsentVersion, object } from './chat.policy';

export const maxAudioBytes = 2 * 1024 * 1024;
export const dictationConsentVersion = 'whisper-dictation-v1';
export type AudioUpload = { buffer: Buffer; mimetype: string; size: number };

export function audioFormat(audio?: AudioUpload): 'm4a' | 'wav' {
  if (
    !audio ||
    !Buffer.isBuffer(audio.buffer) ||
    audio.buffer.length < 16 ||
    audio.size !== audio.buffer.length
  )
    throw new BadRequestException('Choose a valid audio recording.');
  if (audio.size > maxAudioBytes)
    throw new PayloadTooLargeException('Keep recordings under 2 MB.');
  if (
    [
      'audio/mp4',
      'audio/m4a',
      'audio/x-m4a',
      'application/octet-stream',
    ].includes(audio.mimetype) &&
    audio.buffer.toString('ascii', 4, 8) === 'ftyp' &&
    audio.buffer.readUInt32BE(0) >= 12 &&
    audio.buffer.readUInt32BE(0) <= audio.size
  )
    return 'm4a';
  if (
    [
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'application/octet-stream',
    ].includes(audio.mimetype) &&
    audio.buffer.toString('ascii', 0, 4) === 'RIFF' &&
    audio.buffer.toString('ascii', 8, 12) === 'WAVE'
  )
    return 'wav';
  throw new BadRequestException('Use an M4A or WAV audio recording.');
}

@Injectable()
export class ChatTranscriptionService {
  private readonly requests = new Map<
    string,
    { active: boolean; startedAt: number; attempts: number }
  >();
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async access(userId: string, patientId: string) {
    const member = await this.prisma.careMembership.findFirst({
      where: { userId, patientId, revokedAt: null },
      select: {
        user: {
          select: {
            chatProcessingConsentedAt: true,
            chatProcessingConsentVersion: true,
          },
        },
      },
    });
    if (!member) throw new NotFoundException('Care Circle not found.');
    if (
      !member.user.chatProcessingConsentedAt ||
      member.user.chatProcessingConsentVersion !== chatConsentVersion
    )
      throw new ForbiddenException(
        'Please enable AI chat before using dictation.',
      );
  }

  async transcribe(
    userId: string,
    patientId: string,
    consent: string | undefined,
    audio?: AudioUpload,
  ) {
    let reservation:
      { active: boolean; startedAt: number; attempts: number } | undefined;
    try {
      await this.access(userId, patientId);
      if (consent !== dictationConsentVersion)
        throw new BadRequestException(
          'Confirm audio transcription before recording.',
        );
      if (
        this.config.get('CHAT_PROCESSING_APPROVED') !== 'true' ||
        !this.config.get<string>('NEARAI_API_KEY')
      )
        throw new ServiceUnavailableException(
          'Audio transcription is not enabled yet. You can still type.',
        );
      const format = audioFormat(audio);
      const now = Date.now();
      // shortcut: per-process pilot limit; use a shared limiter before running API replicas.
      for (const [key, value] of this.requests)
        if (!value.active && now - value.startedAt >= 60_000)
          this.requests.delete(key);
      const previous = this.requests.get(userId);
      if (previous?.active || (previous?.attempts ?? 0) >= 6)
        throw new HttpException(
          'Please wait before recording another message.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      reservation = previous ?? { active: false, startedAt: now, attempts: 0 };
      reservation.active = true;
      reservation.attempts++;
      this.requests.set(userId, reservation);
      let text: string;
      try {
        // NEAR AI Cloud runs Whisper on its own TEE GPU fleet; audio is sent once and never stored.
        const form = new FormData();
        form.append(
          'file',
          new Blob([new Uint8Array(audio!.buffer)]),
          `dictation.${format}`,
        );
        form.append(
          'model',
          this.config.get<string>('CHAT_TRANSCRIPTION_MODEL') ||
            'openai/whisper-large-v3',
        );
        form.append('response_format', 'json');
        const response = await fetch(
          `${this.config.get<string>('NEARAI_BASE_URL') || 'https://cloud-api.near.ai/v1'}/audio/transcriptions`,
          {
            method: 'POST',
            signal: AbortSignal.timeout(45_000),
            headers: {
              Authorization: `Bearer ${this.config.get<string>('NEARAI_API_KEY')}`,
            },
            body: form,
          },
        );
        if (!response.ok) throw new Error('upstream');
        const body = object(await response.json());
        if (typeof body.text !== 'string' || body.text.length > 2000)
          throw new Error('invalid transcript');
        text = body.text.trim();
      } catch {
        throw new ServiceUnavailableException(
          'Transcription could not complete. Please type or record again.',
        );
      }
      await this.access(userId, patientId);
      if (!text)
        throw new BadRequestException(
          'No speech was recognised. Please record again or type.',
        );
      return { text };
    } finally {
      // Audio stays in request memory; never write it or the transcript to files, chat history or logs.
      if (audio && Buffer.isBuffer(audio.buffer)) audio.buffer.fill(0);
      if (reservation) reservation.active = false;
    }
  }
}
