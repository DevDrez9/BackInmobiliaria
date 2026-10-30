import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class CreateReviewerDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateRoleDto {
  @IsEnum(['USER', 'ADMIN', 'REVISOR', 'INMOBILIARIA', 'GRATIS'])
  role: 'USER' | 'ADMIN' | 'REVISOR' | 'INMOBILIARIA' | 'GRATIS';
}

export class UpdateLimitsDto {
  @IsNumber()
  @IsOptional()
  customMaxProperties: number | null;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(['PARTICULAR', 'AGENTE', 'INMOBILIARIA'])
  accountType?: 'PARTICULAR' | 'AGENTE' | 'INMOBILIARIA';

  @IsOptional()
  @IsString()
  logoUrl?: string | null;
}
