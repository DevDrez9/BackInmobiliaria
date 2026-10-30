import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DiffusionsService } from './diffusions.service';
import {
  ApproveDiffusionDto,
  CreateFreeDiffusionDto,
  FilterAdminDiffusionsDto,
  RejectDiffusionDto,
  UpdateDiffusionDto,
} from './dto/diffusions.dto';

@ApiTags('diffusions (Admin & Revisor moderation -> n8n)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class DiffusionsController {
  constructor(private readonly diffusionsService: DiffusionsService) {}

  // Consultar cupo gratis semanal (Lunes a Domingo) y tarifa de difusión extra según plan/cuenta
  @Get('diffusions/quota')
  getMyDiffusionQuota(@Request() req) {
    return this.diffusionsService.getQuotaForUser(req.user.id);
  }

  // Solicitar difusión usando el cupo gratuito semanal (1 por semana de Lunes a Domingo)
  @Post('diffusions/free')
  createFreeDiffusion(@Request() req, @Body() dto: CreateFreeDiffusionDto) {
    return this.diffusionsService.createFreeWeeklyDiffusion(
      req.user.id,
      dto.propertyId,
    );
  }

  // Endpoint del propietario para reenviar tras corregir observaciones
  @Post('diffusions/:id/resubmit')
  resubmit(@Request() req, @Param('id') id: string) {
    return this.diffusionsService.resubmitDiffusionByOwner(req.user.id, id);
  }

  // Contadores rápidos por estado para bandeja de ADMIN y REVISOR
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Get('admin/diffusions/stats')
  getQueueStats() {
    return this.diffusionsService.getQueueStats();
  }

  // Cola paginada de difusiones (ADMIN y REVISOR)
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Get('admin/diffusions')
  listAdminDiffusions(@Query() filter: FilterAdminDiffusionsDto) {
    return this.diffusionsService.listAdminDiffusions(filter);
  }

  // Detalle completo + validación de requisitos (ADMIN y REVISOR)
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Get('admin/diffusions/:id')
  getDiffusionDetail(@Param('id') id: string) {
    return this.diffusionsService.getDiffusionDetail(id);
  }

  // Vista previa exacta del post FB/IG, mapa aproximado y payload que recibirá n8n
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Get('admin/diffusions/:id/preview')
  previewDiffusionForN8n(@Param('id') id: string) {
    return this.diffusionsService.previewDiffusionForN8n(id);
  }

  // Editar texto del post o notas internas antes de aprobar/rechazar
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Patch('admin/diffusions/:id')
  updateDiffusion(
    @Param('id') id: string,
    @Body() dto: UpdateDiffusionDto,
  ) {
    return this.diffusionsService.updateDiffusionDraft(id, dto);
  }

  // Aprobar -> dispara publicación hacia el contenedor n8n
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Post('admin/diffusions/:id/approve')
  approveDiffusion(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ApproveDiffusionDto,
  ) {
    return this.diffusionsService.approveDiffusion(req.user.id, id, dto);
  }

  // Rechazar -> bloquea envío a n8n y notifica motivo al propietario
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Post('admin/diffusions/:id/reject')
  rejectDiffusion(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: RejectDiffusionDto,
  ) {
    return this.diffusionsService.rejectDiffusion(req.user.id, id, dto);
  }

  // Reintentar envío a n8n cuando quedó en ERROR (solo publica en la red faltante)
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Post('admin/diffusions/:id/retry')
  retryDiffusion(@Request() req, @Param('id') id: string) {
    return this.diffusionsService.retryDiffusion(req.user.id, id);
  }
}
