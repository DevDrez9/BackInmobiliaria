import { Module } from '@nestjs/common';
import { DiffusionsService } from './diffusions.service';
import {
  DiffusionsController,
  PublicDiffusionsController,
} from './diffusions.controller';
import { SocialCardService } from './social-card.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule],
  controllers: [DiffusionsController, PublicDiffusionsController],
  providers: [DiffusionsService, SocialCardService],
  exports: [DiffusionsService, SocialCardService],
})
export class DiffusionsModule {}
