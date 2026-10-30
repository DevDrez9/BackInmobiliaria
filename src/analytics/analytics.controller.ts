import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import {
  PropertyStatsQueryDto,
  TrackPropertyEventDto,
} from './dto/analytics.dto';

@ApiTags('analytics')
@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('events')
  trackEvent(@Body() dto: TrackPropertyEventDto) {
    return this.analyticsService.trackEvent(dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('properties/:id/stats')
  getPropertyStats(
    @Request() req,
    @Param('id') id: string,
    @Query() query: PropertyStatsQueryDto,
  ) {
    return this.analyticsService.getPropertyStats(
      req.user.id,
      id,
      query.days ?? 30,
    );
  }
}
