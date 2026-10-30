import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';

export interface GenerateQrParams {
  amount: number;
  idempotencyKey: string;
  description?: string;
  expirationMinutes: number;
}

export interface GatewayQrResponse {
  id: number;
  internalTransactionId: string;
  bankQrId: string;
  amountTotal: number;
  amountCommission: number;
  amountNet: number;
  status: 'PENDING' | 'PAID' | 'CANCELLED';
  qrImageBase64?: string;
  expirationDate: string;
  paidAt: string | null;
  createdAt: string;
}

interface GatewayEnvelope<T> {
  estado: 'EXITO' | 'ERROR';
  respuesta: T | null;
  mensaje: string;
}

@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  private get baseUrl(): string {
    const url = process.env.PASARELA_BASE_URL;
    if (!url) {
      throw new InternalServerErrorException(
        'PASARELA_BASE_URL no está configurada en el servidor',
      );
    }
    return url.replace(/\/+$/, '');
  }

  private get apiKey(): string {
    const key = process.env.PASARELA_API_KEY;
    if (!key) {
      throw new InternalServerErrorException(
        'PASARELA_API_KEY no está configurada en el servidor',
      );
    }
    return key;
  }

  private get webhookSecret(): string {
    const secret = process.env.PASARELA_WEBHOOK_SECRET;
    if (!secret) {
      throw new InternalServerErrorException(
        'PASARELA_WEBHOOK_SECRET no está configurada en el servidor',
      );
    }
    return secret;
  }

  private getHeaders(): Record<string, string> {
    return {
      'X-API-KEY': this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async generateQr(params: GenerateQrParams): Promise<GatewayQrResponse> {
    const formattedAmount = Number(params.amount.toFixed(2));
    if (formattedAmount <= 0) {
      throw new BadRequestException('El monto a cobrar debe ser mayor a 0.00 Bs');
    }

    const body = {
      amount: formattedAmount,
      idempotencyKey: params.idempotencyKey,
      description: params.description,
      expirationMinutes: params.expirationMinutes,
    };

    const data = await this.request<GatewayQrResponse>(
      'POST',
      '/api/v1/gateway/qr/generate',
      body,
    );

    return data;
  }

  async getQrStatus(idempotencyKey: string): Promise<GatewayQrResponse> {
    return this.request<GatewayQrResponse>(
      'GET',
      `/api/v1/gateway/qr/status/${encodeURIComponent(idempotencyKey)}`,
    );
  }

  async forceSyncQr(idempotencyKey: string): Promise<GatewayQrResponse> {
    return this.request<GatewayQrResponse>(
      'POST',
      `/api/v1/gateway/qr/sync/${encodeURIComponent(idempotencyKey)}`,
    );
  }

  verifyWebhookSignature(
    rawBody: Buffer | string | undefined,
    signatureReceived: string | undefined,
  ): boolean {
    if (!rawBody || !signatureReceived) {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('base64');

    const receivedBuf = Buffer.from(signatureReceived, 'utf8');
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');

    if (receivedBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(receivedBuf, expectedBuf);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.getHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error: any) {
      this.logger.error(`Error de red conectando a ApiBanco (${path}): ${error?.message}`);
      throw new BadGatewayException(
        'No fue posible comunicarse con la pasarela de pagos QR. Intenta nuevamente.',
      );
    }

    let json: GatewayEnvelope<T> | null = null;
    try {
      json = (await response.json()) as GatewayEnvelope<T>;
    } catch {
      this.logger.error(`Respuesta no JSON de ApiBanco (${response.status})`);
      throw new BadGatewayException('Respuesta inválida de la pasarela de pagos');
    }

    if (response.status === 429) {
      throw new HttpException(
        json?.mensaje || 'Demasiadas solicitudes a la pasarela de pagos, intenta en unos segundos.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!response.ok || json.estado !== 'EXITO' || !json.respuesta) {
      this.logger.warn(
        `Error ApiBanco [${response.status}] en ${path}: ${json?.mensaje || 'Sin detalle'}`,
      );
      if (response.status === 400) {
        throw new BadRequestException(
          json?.mensaje || 'Parámetros rechazados por la pasarela de pagos',
        );
      }
      throw new BadGatewayException(
        json?.mensaje || 'Error al procesar la solicitud con la pasarela de pagos',
      );
    }

    return json.respuesta;
  }
}
