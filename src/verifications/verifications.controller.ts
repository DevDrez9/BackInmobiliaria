import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { VerificationsService } from './verifications.service';
import {
  ApproveVerificationDto,
  RejectVerificationDto,
  UpdateVerificationNotesDto,
  UploadVerificationDocsBodyDto,
} from './dto/verifications.dto';

const privateVerificationsDir = path.resolve(
  process.cwd(),
  'uploads',
  'private-verifications',
);

if (!fs.existsSync(privateVerificationsDir)) {
  fs.mkdirSync(privateVerificationsDir, { recursive: true });
}

@ApiTags('verifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class VerificationsController {
  constructor(private readonly verificationsService: VerificationsService) {}

  @Get('verifications/me')
  getMyVerifications(@Request() req) {
    return this.verificationsService.getMyVerifications(req.user.id);
  }

  @Post('verifications/:id/documents')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: privateVerificationsDir,
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase();
          const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
          cb(null, unique);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB por archivo
      },
      fileFilter: (_req, file, cb) => {
        const allowed = [
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/webp',
        ];
        if (!allowed.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Formato no permitido. Sube archivos PDF, JPG, PNG o WEBP.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  uploadDocuments(
    @Request() req,
    @Param('id') id: string,
    @UploadedFiles() files: Array<any>,
    @Body() body: UploadVerificationDocsBodyDto,
  ) {
    return this.verificationsService.attachDocuments(
      req.user.id,
      id,
      files,
      body.docType,
    );
  }

  @Get('verifications/:id/documents/:filename')
  async downloadPrivateDocument(
    @Request() req,
    @Param('id') id: string,
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filePath, doc } =
      await this.verificationsService.getPrivateDocumentFile(
        req.user.id,
        id,
        filename,
      );

    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.originalName)}"`,
      'Cache-Control': 'private, no-store',
    });

    const stream = fs.createReadStream(filePath);
    return new StreamableFile(stream);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Get('admin/verifications')
  listAdminVerifications(@Query('status') status?: string) {
    return this.verificationsService.listAdminVerifications(status);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Patch('admin/verifications/:id/notes')
  updateInternalNotes(
    @Param('id') id: string,
    @Body() dto: UpdateVerificationNotesDto,
  ) {
    return this.verificationsService.updateInternalNotes(id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Post('admin/verifications/:id/approve')
  approveVerification(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ApproveVerificationDto,
  ) {
    return this.verificationsService.approveVerification(req.user.id, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'REVISOR')
  @Post('admin/verifications/:id/reject')
  rejectVerification(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: RejectVerificationDto,
  ) {
    return this.verificationsService.rejectVerification(req.user.id, id, dto);
  }
}
