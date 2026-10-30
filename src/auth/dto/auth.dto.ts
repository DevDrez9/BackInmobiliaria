import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsOptional()
  @IsEnum(['PARTICULAR', 'AGENTE', 'INMOBILIARIA'])
  accountType?: 'PARTICULAR' | 'AGENTE' | 'INMOBILIARIA';

  @IsOptional()
  @IsString()
  logoUrl?: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
