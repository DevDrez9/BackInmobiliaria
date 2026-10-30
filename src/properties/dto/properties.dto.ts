import {
  IsString,
  IsNumber,
  IsEnum,
  IsArray,
  IsOptional,
  IsUrl,
  IsInt,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreatePropertyDto {
  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsNumber()
  price: number;

  @IsEnum(['BOB', 'USD'])
  currency: 'BOB' | 'USD';

  @IsEnum(['VENTA', 'ALQUILER', 'ANTICRETICO'])
  listingType: 'VENTA' | 'ALQUILER' | 'ANTICRETICO';

  @IsEnum(['CASA', 'DEPARTAMENTO', 'TIENDA', 'LOCAL', 'OTRO'])
  propertyType: 'CASA' | 'DEPARTAMENTO' | 'TIENDA' | 'LOCAL' | 'OTRO';

  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsString()
  whatsapp?: string;

  @IsArray()
  @IsString({ each: true })
  images: string[];

  @IsOptional()
  @IsUrl()
  facebookUrl?: string;
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}

export class UpdatePropertyStatusDto {
  @IsEnum(['ACTIVO', 'PAUSADO', 'INACTIVO'])
  status: 'ACTIVO' | 'PAUSADO' | 'INACTIVO';
}
