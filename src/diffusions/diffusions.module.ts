import { Module } from '@nestjs/common';
import { DiffusionsService } from './diffusions.service';
import { DiffusionsController } from './diffusions.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [DiffusionsController],
  providers: [DiffusionsService],
  exports: [DiffusionsService],
})
export class DiffusionsModule {}
