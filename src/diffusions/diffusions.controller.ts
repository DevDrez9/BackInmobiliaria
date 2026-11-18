import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Response } from 'express';
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

@ApiTags('public-social-cards (Meta Graph API, n8n & App Deep Link)')
@Controller('public')
export class PublicDiffusionsController {
  constructor(private readonly diffusionsService: DiffusionsService) {}

  @Get('app')
  openAppRoot(@Res() res: Response) {
    const html = this.diffusionsService.buildAppRedirectHtml();
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(html);
  }

  @Get('app/inmueble/:id')
  openPropertyInApp(@Param('id') id: string, @Res() res: Response) {
    const html = this.diffusionsService.buildAppRedirectHtml(id);
    res.set({ 'Content-Type': 'text/html; charset=utf-8' });
    res.send(html);
  }

  @Get('logo-alquilabo.jpg')
  async getLogo(@Res() res: Response) {
    const logoPath = path.join(process.cwd(), 'assets', 'logo-alquilabo.jpg');
    const buf = await fs.readFile(logoPath);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(buf);
  }

  @Get([
    'tiktokO8O2OE6rV3fgyKxYdNwizMxYnfRfNmiF.txt',
    'app/tiktokO8O2OE6rV3fgyKxYdNwizMxYnfRfNmiF.txt',
  ])
  getTikTokVerificationExact(@Res() res: Response) {
    res.set({ 'Content-Type': 'text/plain; charset=utf-8' });
    res.send(
      'tiktok-developers-site-verification=O8O2OE6rV3fgyKxYdNwizMxYnfRfNmiF',
    );
  }

  @Get('diffusions/city-cover/:city/social-card.jpg')
  async getCityCoverSocialCardJpg(
    @Param('city') city: string,
    @Query('date') date: string | undefined,
    @Query('count') count: string | undefined,
    @Res() res: Response,
  ) {
    const parsedCount = count ? parseInt(count, 10) : undefined;
    const buffer = await this.diffusionsService.getCityCoverCardBuffer(city, {
      date,
      count: Number.isNaN(parsedCount as number) ? undefined : parsedCount,
      format: 'jpeg',
    });
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buffer);
  }

  @Get('diffusions/city-cover/:city/social-card.png')
  async getCityCoverSocialCardPng(
    @Param('city') city: string,
    @Query('date') date: string | undefined,
    @Query('count') count: string | undefined,
    @Res() res: Response,
  ) {
    const parsedCount = count ? parseInt(count, 10) : undefined;
    const buffer = await this.diffusionsService.getCityCoverCardBuffer(city, {
      date,
      count: Number.isNaN(parsedCount as number) ? undefined : parsedCount,
      format: 'png',
    });
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buffer);
  }

  @Get('diffusions/:id/social-card.png')
  async getDiffusionSocialCard(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.diffusionsService.getDiffusionSocialCardBuffer(
      id,
      'png',
    );
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buffer);
  }

  @Get('diffusions/:id/social-card.jpg')
  async getDiffusionSocialCardJpg(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.diffusionsService.getDiffusionSocialCardBuffer(
      id,
      'jpeg',
    );
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buffer);
  }

  @Get('properties/:id/social-card.png')
  async getPropertySocialCard(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.diffusionsService.getPropertySocialCardBuffer(
      id,
      'png',
    );
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buffer);
  }

  @Get('properties/:id/social-card.jpg')
  async getPropertySocialCardJpg(
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.diffusionsService.getPropertySocialCardBuffer(
      id,
      'jpeg',
    );
    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buffer);
  }

  @Get([':tiktokFile', 'app/:tiktokFile'])
  getTikTokVerificationDynamic(
    @Param('tiktokFile') tiktokFile: string,
    @Res() res: Response,
  ) {
    const match = /^tiktok([A-Za-z0-9_-]+)\.txt$/.exec(tiktokFile || '');
    if (!match) {
      res.status(404).send('Not Found');
      return;
    }
    res.set({ 'Content-Type': 'text/plain; charset=utf-8' });
    res.send(`tiktok-developers-site-verification=${match[1]}`);
  }
}

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

  // Vista previa de los lotes diarios agrupados por ciudad que saldrán a las 00:00 (ADMIN y REVISOR)
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Get('admin/diffusions/daily-batches')
  getDailyCityBatches(
    @Query('network') network?: string,
    @Query('date') date?: string,
  ) {
    return this.diffusionsService.getDailyCityBatchesForN8n({
      network,
      date,
    });
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
