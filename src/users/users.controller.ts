import { Controller, Get, Patch, Param, Body, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UpdateRoleDto, UpdateLimitsDto } from './dto/users.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getProfile(@Request() req) {
    return this.usersService.getProfile(req.user.id);
  }

  @Get()
  getAllUsers(@Request() req) {
    return this.usersService.getAllUsers(req.user.id);
  }

  @Patch(':id/role')
  updateRole(@Request() req, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateUserRole(req.user.id, id, dto.role);
  }

  @Patch(':id/limits')
  updateLimits(@Request() req, @Param('id') id: string, @Body() dto: UpdateLimitsDto) {
    return this.usersService.updateMaxProperties(req.user.id, id, dto.customMaxProperties);
  }
}
