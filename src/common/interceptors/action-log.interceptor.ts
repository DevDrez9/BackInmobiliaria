import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ActionLogInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const { method, originalUrl, body, user } = req;

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      // Evitar bloquear la petición, guardamos el log de manera asíncrona
      setTimeout(async () => {
        try {
          // Copiamos el body para poder censurar contraseñas si existen
          let safePayload: any = undefined;
          if (body && Object.keys(body).length > 0) {
            safePayload = { ...body };
            if (safePayload.password) {
              safePayload.password = '[HIDDEN]';
            }
          }

          await this.prisma.actionLog.create({
            data: {
              userId: user?.id || null, // Puede ser null si es una ruta pública sin token (ej. login)
              method,
              route: originalUrl,
              payload: safePayload,
            },
          });
        } catch (error) {
          console.error('Error saving action log:', error);
        }
      }, 0);
    }

    return next.handle();
  }
}
