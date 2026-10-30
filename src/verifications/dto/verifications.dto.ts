import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UploadVerificationDocsBodyDto {
  @IsOptional()
  @IsString()
  docType?: string;
}

export class UpdateVerificationNotesDto {
  @IsString()
  internalNotes: string;
}

export class ApproveVerificationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  validMonths?: number;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}

export class RejectVerificationDto {
  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;
}
