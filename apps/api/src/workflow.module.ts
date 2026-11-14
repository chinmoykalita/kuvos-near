import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { DocumentStorageService } from './document-storage.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, DocumentStorageService],
  exports: [WorkflowService, DocumentStorageService],
})
export class WorkflowModule {}
