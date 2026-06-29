import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type { IOtpService } from './otp.interfaces';
import type { HistoryQuery, ProcessOtpBody } from './otp.schemas';

/**
 * OTP HTTP katmanı (SRP: yalnızca request/response).
 * `projectId` body'den değil `req.user`'dan alınır → proje izolasyonu garanti.
 * Result açılır; hata ise `next`, değilse standart zarfla döner.
 */
export class OtpController {
  constructor(private readonly otpService: IOtpService) {}

  process = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const body = req.body as ProcessOtpBody;
    const result = await this.otpService.processAndDeliver({
      smsText: body.smsText,
      code: body.code,
      source: body.source,
      projectId: req.user.projectId,
    });

    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  history = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const query = req.query as unknown as HistoryQuery;
    const result = await this.otpService.getHistory({
      projectId: req.user.projectId,
      page: query.page,
      limit: query.limit,
    });

    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({
      success: true,
      data: result.data.items,
      pagination: result.data.pagination,
      requestId: req.id,
    });
  };
}
