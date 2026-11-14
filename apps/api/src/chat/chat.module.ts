import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatModel } from './chat.model';
import { ChatTranscriptionService } from './chat-transcription.service';

@Module({
  imports: [WorkflowModule],
  controllers: [ChatController],
  providers: [ChatService, ChatModel, ChatTranscriptionService],
})
export class ChatModule {}
