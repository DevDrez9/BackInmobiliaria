import * as crypto from 'crypto';
import { GatewayService } from './gateway.service';

describe('GatewayService', () => {
  let service: GatewayService;
  const secret = 'test-webhook-secret-123';

  beforeEach(() => {
    process.env.PASARELA_WEBHOOK_SECRET = secret;
    process.env.PASARELA_BASE_URL = 'https://apibanco.example.com';
    process.env.PASARELA_API_KEY = 'test-api-key';
    service = new GatewayService();
  });

  it('validates a legitimate HMAC-SHA256 Base64 X-Signature over rawBody', () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        eventType: 'QR_PAYMENT_COMPLETED',
        transactionId: 'ORD-SUB-1001',
        details: { amountTotal: 49.0 },
      }),
      'utf8',
    );

    const validSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    expect(service.verifyWebhookSignature(rawBody, validSignature)).toBe(true);
  });

  it('rejects a tampered body or wrong signature safely without throwing RangeError', () => {
    const rawBody = Buffer.from('{"amountTotal":49.00}', 'utf8');
    expect(service.verifyWebhookSignature(rawBody, 'short-sig')).toBe(false);

    const forgedSignature = crypto
      .createHmac('sha256', 'wrong-secret')
      .update(rawBody)
      .digest('base64');

    expect(service.verifyWebhookSignature(rawBody, forgedSignature)).toBe(false);
    expect(service.verifyWebhookSignature(undefined, forgedSignature)).toBe(
      false,
    );
  });
});
