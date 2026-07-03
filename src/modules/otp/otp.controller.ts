import type { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { AuthenticationError, DeviceAuthError } from '@errors/errors';
import type { IOtpService } from './otp.interfaces';
import type {
  DismissOtpsBody,
  HistoryQuery,
  ProcessOtpBody,
  SharingParams,
  ToggleSharingBody,
} from './otp.schemas';

/**
 * OTP HTTP katmanı (SRP: yalnızca request/response).
 * `POST /api/otp`: `projectId`/`deviceId`/`receiverId` body'den değil doğrulanmış cihazdan
 * (`req.device`) alınır → proje izolasyonu + kaynak izleme + sahiplik.
 * `GET /history` ve sharing endpoint'leri kullanıcı oturumundan (`req.user`) çalışır.
 * Result açılır; hata ise `next`, değilse standart zarfla döner.
 */
export class OtpController {
  constructor(private readonly otpService: IOtpService) {}

  process = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.device) {
      next(new DeviceAuthError('Cihaz kimliği doğrulanamadı'));
      return;
    }

    const body = req.body as ProcessOtpBody;
    const result = await this.otpService.processAndDeliver({
      code: body.code,
      source: body.source,
      senderRaw: body.senderRaw,
      projectId: req.device.projectId,
      deviceId: req.device.id,
      receiverId: req.device.userId,
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

    // Rol-duyarlı: RECEIVER kendi kayıtları, ADMIN projedeki TÜM OTP'ler (özet),
    // DEVELOPER kendisine yönlendirilen (dismiss'lemediği) feed.
    const result =
      req.user.role === Role.RECEIVER
        ? await this.otpService.getReceiverHistory({
            receiverId: req.user.sub,
            projectId: req.user.projectId,
            page: query.page,
            limit: query.limit,
          })
        : req.user.role === Role.ADMIN
          ? await this.otpService.getAllForProject({
              projectId: req.user.projectId,
              page: query.page,
              limit: query.limit,
            })
          : await this.otpService.getHistory({
              developerId: req.user.sub,
              projectId: req.user.projectId,
              page: query.page,
              limit: query.limit,
            });

    if (!result.success) {
      next(result.error);
      return;
    }
    // Zarf aynı: hem developer hem receiver için { data: items[], pagination }.
    res.status(200).json({
      success: true,
      data: result.data.items,
      pagination: result.data.pagination,
      requestId: req.id,
    });
  };

  toggleSharing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as SharingParams;
    const body = req.body as ToggleSharingBody;
    const result = await this.otpService.toggleSharing(
      id,
      req.user.sub,
      body.sharingActive,
    );

    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  getSharing = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as SharingParams;
    const result = await this.otpService.getSharingTargets(id, req.user.sub);

    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  // DEVELOPER seçtiği OTP'leri KENDİ feed'inden kaldırır (yumuşak gizleme, kalıcı silme değil).
  dismiss = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const body = req.body as DismissOtpsBody;
    const result = await this.otpService.dismissForDeveloper(
      req.user.sub,
      req.user.projectId,
      body.otpIds,
    );

    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
