import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type {
  IAuthService,
  LoginDTO,
  RefreshDTO,
  RegisterDTO,
} from './auth.interfaces';

/**
 * Auth HTTP katmanı (SRP: yalnızca request/response).
 * İş mantığı yok — Result'ı açar, hata ise `next`, değilse standart zarfla döner.
 * Beklenmeyen throw'lar route'taki asyncHandler ile errorHandler'a iletilir.
 */
export class AuthController {
  constructor(private readonly authService: IAuthService) {}

  register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.authService.register(req.body as RegisterDTO);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(201).json({ success: true, data: result.data, requestId: req.id });
  };

  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.authService.login(req.body as LoginDTO);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await this.authService.refresh(req.body as RefreshDTO);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }
    const result = await this.authService.logout(req.user.sub);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
