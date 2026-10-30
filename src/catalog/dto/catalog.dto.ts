import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyPriceBs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveProperties?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxImagesPerProperty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeWeeklyDiffusions?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  extraDiffusionPriceBs?: number;

  @IsOptional()
  @IsBoolean()
  includesStats?: boolean;

  @IsOptional()
  @IsBoolean()
  includesLogo?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  priceBs?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  featuredDays?: number | null;

  @IsOptional()
  @IsBoolean()
  includesDiffusion?: boolean;

  @IsOptional()
  @IsBoolean()
  includesVerification?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
