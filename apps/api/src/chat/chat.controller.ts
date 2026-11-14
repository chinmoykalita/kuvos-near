import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Header,
  Headers,
  UploadedFile,
  UseInterceptors,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ChatService } from './chat.service';
import {
  ChatTranscriptionService,
  maxAudioBytes,
} from './chat-transcription.service';
import type { AudioUpload } from './chat-transcription.service';

@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly transcription: ChatTranscriptionService,
  ) {}

  @Post('patients/:id/chat/transcription')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store, private')
  @Header('Pragma', 'no-cache')
  // No dest/storage option: Multer's memory storage keeps this upload off disk.
  @UseInterceptors(
    FileInterceptor('audio', {
      limits: { fileSize: maxAudioBytes, files: 1, fields: 0, parts: 2 },
    }),
  )
  transcribe(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-dictation-consent') consent: string | undefined,
    @UploadedFile() audio?: AudioUpload,
  ) {
    return this.transcription.transcribe(session.user.id, id, consent, audio);
  }

  @Get('patients/:id/chat')
  state(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.state(session.user.id, id);
  }

  @Post('patients/:id/chat/messages')
  send(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.chat.send(session.user.id, id, body);
  }

  @Delete('patients/:id/chat/messages')
  clear(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.clear(session.user.id, id);
  }

  @Delete('patients/:id/chat/memories/:memoryId')
  forget(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memoryId', ParseUUIDPipe) memoryId: string,
  ) {
    return this.chat.forget(session.user.id, id, memoryId);
  }

  @Put('chat/consent')
  consent(@Session() session: UserSession, @Body() body: unknown) {
    return this.chat.consent(session.user.id, body);
  }
}
