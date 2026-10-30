import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TrackPropertyEventDto {
  @IsUUID()
  propertyId: string;

  @IsEnum([
    'VISTA_PIN',
    'VISTA_DETALLE',
    'CLIC_CONTACTO',
    'CLIC_WHATSAPP',
    'CLIC_LLAMAR',
  ])
  type:
    | 'VISTA_PIN'
    | 'VISTA_DETALLE'
    | 'CLIC_CONTACTO'
    | 'CLIC_WHATSAPP'
    | 'CLIC_LLAMAR';

  @IsOptional()
  @IsString()
  source?: string;
}

export class PropertyStatsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
