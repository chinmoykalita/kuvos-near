import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { CareService } from './care.service';

@Controller()
export class CareController {
  constructor(private readonly care: CareService) {}

  @Get('patients/:id/rhythm')
  rhythm(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.care.rhythm(session.user.id, id);
  }

  @Get('me')
  getMe(@Session() session: UserSession) {
    return this.care.getMe(session.user.id);
  }

  @Put('me/ai-processing-consent')
  updateAiProcessingConsent(
    @Session() session: UserSession,
    @Body() body: unknown,
  ) {
    return this.care.updateAiProcessingConsent(session.user.id, body);
  }

  @Delete('me')
  deleteAccount(@Session() session: UserSession) {
    return this.care.deleteAccount(session.user.id);
  }

  @AllowAnonymous()
  @Post('account-deletion-requests')
  requestAccountDeletion(@Body() body: unknown) {
    return this.care.requestAccountDeletion(body);
  }

  @Post('patients')
  createPatient(@Session() session: UserSession, @Body() body: unknown) {
    return this.care.createPatient(session.user.id, body);
  }

  @Post('patients/:id/invitations')
  invite(
    @Session() session: UserSession,
    @Param('id') patientId: string,
    @Body() body: unknown,
  ) {
    return this.care.invite(session.user.id, patientId, body);
  }

  @Post('invitations/:id/accept')
  acceptInvitation(
    @Session() session: UserSession,
    @Param('id') invitationId: string,
    @Body() body: unknown,
  ) {
    return this.care.acceptInvitation(session.user.id, invitationId, body);
  }

  @Post('invitations/:id/decline')
  declineInvitation(
    @Session() session: UserSession,
    @Param('id') invitationId: string,
  ) {
    return this.care.declineInvitation(session.user.id, invitationId);
  }

  @Put('patients/:id/marking-window')
  updateMarkingWindow(
    @Session() session: UserSession,
    @Param('id') patientId: string,
    @Body() body: unknown,
  ) {
    return this.care.updateMarkingWindow(session.user.id, patientId, body);
  }

  @Put('patients/:id/care-circle-notifications')
  updateCareCircleNotifications(
    @Session() session: UserSession,
    @Param('id') patientId: string,
    @Body() body: unknown,
  ) {
    return this.care.updateCareCircleNotifications(
      session.user.id,
      patientId,
      body,
    );
  }

  @Post('push-devices/unregister')
  unregisterPushDevice(@Session() session: UserSession, @Body() body: unknown) {
    return this.care.unregisterPushDevice(session.user.id, body);
  }
}
