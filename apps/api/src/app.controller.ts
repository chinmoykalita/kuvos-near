import { Controller, Get } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

@AllowAnonymous()
@Controller('health')
export class AppController {
  @Get()
  getHealth(): { service: string; status: string } {
    return {
      service: 'kuvos-near-api',
      status: 'ok',
    };
  }
}
