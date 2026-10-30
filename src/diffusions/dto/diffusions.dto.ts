import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateFreeDiffusionDto {
  @IsUUID()
  propertyId: string;
}

export class FilterAdminDiffusionsDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateDiffusionDto {
  @IsOptional()
  @IsString()
  postText?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

export class ApproveDiffusionDto {
  @IsOptional()
  @IsString()
  postText?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

export class RejectDiffusionDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

export class N8nDiffusionCallbackDto {
  @IsString()
  @IsNotEmpty()
  difusion_id: string;

  @IsString()
  @IsNotEmpty()
  estado: 'publicado' | 'error' | 'PUBLICADO' | 'ERROR';

  @IsOptional()
  @IsString()
  fb_post_id?: string | null;

  @IsOptional()
  @IsString()
  ig_media_id?: string | null;

  @IsOptional()
  @IsString()
  error?: string | null;
}
