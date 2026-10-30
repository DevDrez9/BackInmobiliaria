import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CreateReviewerDto,
  UpdateRoleDto,
  UpdateLimitsDto,
  UpdateProfileDto,
} from './dto/users.dto';

@ApiTags('users & reviewers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('my-plan')
  getMyPlanRoot(@Request() req) {
    return this.usersService.getMyPlan(req.user.id);
  }

  @Get('users/my-plan')
  getMyPlan(@Request() req) {
    return this.usersService.getMyPlan(req.user.id);
  }

  @Get('users/me')
  getProfile(@Request() req) {
    return this.usersService.getProfile(req.user.id);
  }

  @Patch('users/me')
  updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user.id, dto);
  }

  @Get('users/notifications')
  getNotifications(@Request() req) {
    return this.usersService.getNotifications(req.user.id);
  }

  @Patch('users/notifications/:id/read')
  markNotificationRead(@Request() req, @Param('id') id: string) {
    return this.usersService.markNotificationRead(req.user.id, id);
  }

  @Get('users')
  getAllUsers(@Request() req, @Query('role') role?: string) {
    return this.usersService.getAllUsers(req.user.id, role);
  }

  @Get('admin/reviewers')
  listReviewers(@Request() req) {
    return this.usersService.listReviewers(req.user.id);
  }

  @Post('admin/reviewers')
  createReviewer(@Request() req, @Body() dto: CreateReviewerDto) {
    return this.usersService.createReviewer(req.user.id, dto);
  }

  @Patch('users/:id/role')
  updateRole(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.usersService.updateUserRole(req.user.id, id, dto.role);
  }

  @Patch('users/:id/limits')
  updateLimits(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateLimitsDto,
  ) {
    return this.usersService.updateMaxProperties(
      req.user.id,
      id,
      dto.customMaxProperties,
    );
  }
}
