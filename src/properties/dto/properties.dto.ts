import { IsString, IsNumber, IsEnum, IsArray, IsOptional, IsUrl } from 'class-validator';

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

export class UpdatePropertyDto extends CreatePropertyDto {}
