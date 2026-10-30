import { Module } from '@nestjs/common';
import { DiffusionsService } from './diffusions.service';
import { DiffusionsController } from './diffusions.controller';

@Module({
  controllers: [DiffusionsController],
  providers: [DiffusionsService],
  exports: [DiffusionsService],
})
export class DiffusionsModule {}
