import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('tiktokO8O2OE6rV3fgyKxYdNwizMxYnfRfNmiF.txt')
  getTikTokRootVerification(@Res() res: Response) {
    res.set({ 'Content-Type': 'text/plain; charset=utf-8' });
    res.send(
      'tiktok-developers-site-verification=O8O2OE6rV3fgyKxYdNwizMxYnfRfNmiF',
    );
  }
}
