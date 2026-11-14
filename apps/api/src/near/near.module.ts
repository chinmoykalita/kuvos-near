import { Global, Module } from '@nestjs/common';
import { NearController } from './near.controller';
import { NearPublisher } from './near-publisher.service';
import { NearService } from './near.service';

@Global()
@Module({
  controllers: [NearController],
  providers: [NearService, NearPublisher],
  exports: [NearService, NearPublisher],
})
export class NearModule {}
