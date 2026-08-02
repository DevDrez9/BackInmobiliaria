import { IsEnum, IsNumber, IsOptional } from 'class-validator';

export class UpdateRoleDto {
  @IsEnum(['ADMIN', 'INMOBILIARIA', 'GRATIS'])
  role: 'ADMIN' | 'INMOBILIARIA' | 'GRATIS';
}

export class UpdateLimitsDto {
  @IsNumber()
  @IsOptional()
  customMaxProperties: number | null;
}
