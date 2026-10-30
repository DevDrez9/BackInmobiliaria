import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { PropertiesService } from './properties.service';
import {
  CreatePropertyDto,
  UpdatePropertyDto,
  UpdatePropertyStatusDto,
} from './dto/properties.dto';
import { FilterPropertiesDto } from './dto/filter-properties.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('properties')
@Controller('properties')
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post()
  create(@Request() req, @Body() createPropertyDto: CreatePropertyDto) {
    return this.propertiesService.create(req.user.id, createPropertyDto);
  }

  @Get()
  findAll(@Query() filterDto: FilterPropertiesDto) {
    return this.propertiesService.findAll(filterDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me')
  findMyProperties(@Request() req) {
    return this.propertiesService.findMyProperties(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.propertiesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':id/status')
  updateStatus(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyStatusDto,
  ) {
    return this.propertiesService.updateStatus(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() updatePropertyDto: UpdatePropertyDto,
  ) {
    return this.propertiesService.update(req.user.id, id, updatePropertyDto);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.propertiesService.remove(req.user.id, id);
  }
}
