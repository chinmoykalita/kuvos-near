import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllowAnonymous, Session } from '@thallesp/nestjs-better-auth';
import type { UserSession } from '@thallesp/nestjs-better-auth';
import { NearService } from './near.service';
import { verifyBundle } from './verify-core';
import { GATE_HASH, GATE_RULES } from './tomo-gate';

@Controller('near')
export class NearController {
  constructor(
    private readonly near: NearService,
    private readonly config: ConfigService,
  ) {}

  @AllowAnonymous()
  @Get('config')
  configuration() {
    return {
      enabled: this.near.enabled(),
      network: this.near.network(),
      contractId: this.near.contractId(),
      rpcUrl: this.near.rpcUrl(),
      policy: {
        version: GATE_RULES.version,
        hash: GATE_HASH,
        rules: GATE_RULES,
      },
      contractUrl: this.near.contractId()
        ? this.near.explorer('account', this.near.contractId())
        : null,
    };
  }

  // Public: anyone can paste an exported bundle and re-run the checks against NEAR.
  @AllowAnonymous()
  @Post('verify')
  @HttpCode(200)
  async verify(@Body() body: unknown) {
    if (JSON.stringify(body ?? null).length > 300_000)
      return { checks: [{ name: 'Bundle', ok: false, detail: 'Too large.' }] };
    return { checks: await verifyBundle(body, { rpcUrl: this.near.rpcUrl() }) };
  }

  @Get('wallet')
  wallet(@Session() session: UserSession) {
    return this.near.wallet(session.user.id);
  }

  @Post('wallet/challenge')
  challenge(@Session() session: UserSession, @Body() body: unknown) {
    return this.near.challenge(session.user.id, body);
  }

  @Post('wallet/connect')
  connect(@Session() session: UserSession, @Body() body: unknown) {
    return this.near.connect(session.user.id, body);
  }

  @Delete('wallet')
  disconnect(@Session() session: UserSession) {
    return this.near.disconnect(session.user.id);
  }

  @Get('patients/:id/events')
  list(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.near.list(session.user.id, id);
  }

  @Get('subjects/:kind/:subjectId')
  subject(
    @Session() session: UserSession,
    @Param('kind') kind: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ) {
    return this.near.subject(session.user.id, kind, subjectId);
  }

  @Get('events/:id')
  get(@Session() session: UserSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.near.get(session.user.id, id);
  }

  @Post('events/:id/signature')
  sign(
    @Session() session: UserSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.near.sign(session.user.id, id, body);
  }
}
