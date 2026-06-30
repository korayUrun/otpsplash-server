import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type { IDeviceService } from './device.interfaces';
import type { DeviceIdParams, RegisterDeviceBody } from './device.schemas';

/**
 * Cihaz HTTP katmanı (SRP: yalnızca request/response).
 * `userId`/`projectId` body'den değil `req.user`'dan alınır → cihaz daima
 * onu kaydeden kullanıcıya bağlanır. Result açılır; hata ise `next`, değilse zarfla döner.
 */
export class DeviceController {
  constructor(private readonly deviceService: IDeviceService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const body = req.body as RegisterDeviceBody;
    const result = await this.deviceService.register({
      platform: body.platform,
      userId: req.user.sub,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    // deviceSecret düz metin olarak SADECE burada döner.
    res.status(201).json({ success: true, data: result.data, requestId: req.id });
  };

  revoke = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as DeviceIdParams;
    const result = await this.deviceService.revoke(id, req.user.sub);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const result = await this.deviceService.list(req.user.sub);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
