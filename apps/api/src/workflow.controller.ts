import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { createReadStream } from 'node:fs';
import { WorkflowService } from './workflow.service';
import { DocumentStorageService } from './document-storage.service';

@Controller()
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly storage: DocumentStorageService,
  ) {}

  @Post('documents')
  upload(@Session() session: UserSession, @Body() body: unknown) {
    return this.workflow.upload(session.user.id, body);
  }

  @Post('documents/:id/complete')
  completeUpload(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.completeUpload(session.user.id, id, body);
  }

  @Get('extractions/:id')
  getExtraction(@Session() session: UserSession, @Param('id') id: string) {
    return this.workflow.getExtraction(session.user.id, id);
  }

  @Get('extractions/:id/pages/:page')
  @Header('Content-Type', 'image/png')
  async getPage(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Param('page', ParseIntPipe) page: number,
  ): Promise<StreamableFile> {
    const path = await this.workflow.getPagePath(session.user.id, id, page);
    return path.startsWith('s3://')
      ? this.storage.page(path)
      : new StreamableFile(createReadStream(path));
  }

  @Put('extractions/:id/review')
  saveReview(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.saveReview(session.user.id, id, body);
  }

  @Post('extractions/:id/confirm')
  confirm(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.confirm(session.user.id, id, body);
  }

  @Get('patients/:id/today')
  getPatientToday(
    @Session() session: UserSession,
    @Param('id') patientId: string,
    @Query('date') date?: string,
  ) {
    return this.workflow.getPatientToday(session.user.id, patientId, date);
  }

  @Get('patients/:id/notification-schedule')
  getPatientNotificationSchedule(
    @Session() session: UserSession,
    @Param('id') patientId: string,
  ) {
    return this.workflow.getPatientNotificationSchedule(
      session.user.id,
      patientId,
    );
  }

  @Get('patients/:id/plans')
  listPlans(@Session() session: UserSession, @Param('id') patientId: string) {
    return this.workflow.listPlans(session.user.id, patientId);
  }

  @Get('plans/:id/today')
  getToday(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Query('date') date?: string,
  ) {
    return this.workflow.getToday(session.user.id, id, date);
  }

  @Patch('plans/:id')
  renamePlan(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.renamePlan(session.user.id, id, body);
  }

  @Post('plans/:id/close')
  closePlan(@Session() session: UserSession, @Param('id') id: string) {
    return this.workflow.closePlan(session.user.id, id);
  }

  @Post('occurrences/:id/log')
  logOccurrence(
    @Session() session: UserSession,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.workflow.logOccurrence(session.user.id, id, body);
  }
}
