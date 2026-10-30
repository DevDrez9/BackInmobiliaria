import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { GatewayService } from '../gateway/gateway.service';
import { FulfillmentService } from '../orders/fulfillment.service';
import { DiffusionsService } from '../diffusions/diffusions.service';
import { N8nDiffusionCallbackDto } from '../diffusions/dto/diffusions.dto';

@ApiTags('webhooks')
@SkipThrottle()
@Controller()
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly gatewayService: GatewayService,
    private readonly fulfillmentService: FulfillmentService,
    private readonly diffusionsService: DiffusionsService,
  ) {}

  private assertN8nSecret(secretReceived?: string) {
    const expected = process.env.N8N_WEBHOOK_SECRET;
    if (!expected) {
      throw new ForbiddenException('N8N_WEBHOOK_SECRET no configurado');
    }
    if (!secretReceived) {
      throw new UnauthorizedException('Falta cabecera X-Webhook-Secret');
    }

    const bufA = Buffer.from(secretReceived, 'utf8');
    const bufB = Buffer.from(expected, 'utf8');
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      throw new ForbiddenException('Secreto de webhook n8n inválido');
    }
  }

  @Post('webhooks/pasarela')
  @HttpCode(200)
  async handleGatewayWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature?: string,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Falta cabecera X-Signature');
    }

    const isValid = this.gatewayService.verifyWebhookSignature(
      req.rawBody,
      signature,
    );

    if (!isValid) {
      this.logger.warn('Intento de webhook ApiBanco con firma X-Signature inválida');
      throw new ForbiddenException('Firma no autorizada');
    }

    const event = req.body as {
      eventType?: string;
      transactionId?: string;
      bankReference?: string;
      status?: string;
      message?: string;
      details?: {
        id?: number;
        internalTransactionId?: string;
        bankQrId?: string;
        amountTotal?: number;
        amountCommission?: number;
        amountNet?: number;
        status?: string;
        paidAt?: string;
      };
    };

    this.logger.log(
      `Webhook ApiBanco recibido: ${event.eventType} | tx=${event.transactionId}`,
    );

    if (event.eventType === 'QR_PAYMENT_COMPLETED' && event.transactionId) {
      await this.fulfillmentService.confirmPaymentFromGateway({
        idempotencyKey: event.transactionId,
        externalReference: event.details?.bankQrId || event.bankReference,
        gatewayTxId: event.details?.id,
        amountPaid: Number(event.details?.amountTotal ?? 0),
        amountCommission: event.details?.amountCommission,
        amountNet: event.details?.amountNet,
        paidAt: event.details?.paidAt,
        rawPayload: event,
      });
    }

    return { status: 'received' };
  }

  @Post(['webhooks/n8n/diffusion', 'webhooks/n8n/difusion'])
  @HttpCode(200)
  async handleN8nDiffusionCallback(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() dto: N8nDiffusionCallbackDto,
  ) {
    this.assertN8nSecret(secret);
    await this.diffusionsService.handleN8nCallback(dto);
    return { status: 'ok' };
  }

  @Get(['n8n/weekly-summary', 'n8n/resumen-semanal'])
  async getN8nWeeklySummary(
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    this.assertN8nSecret(secret);
    return this.diffusionsService.getWeeklySummaryForN8n();
  }
}
