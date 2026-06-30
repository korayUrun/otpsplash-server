import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type { IRoutingService } from './routing.interfaces';
import type {
  CreateRoutingRuleBody,
  RoutingIdParams,
  ToggleRuleBody,
} from './routing.schemas';

/**
 * Yönlendirme kuralı HTTP katmanı (SRP: yalnızca request/response).
 * `projectId` body'den değil `req.user`'dan alınır → proje izolasyonu.
 * Result açılır; hata ise `next`, değilse standart zarfla döner.
 */
export class RoutingController {
  constructor(private readonly routingService: IRoutingService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const body = req.body as CreateRoutingRuleBody;
    const result = await this.routingService.createRule({
      receiverId: body.receiverId,
      serviceId: body.serviceId,
      targetType: body.targetType,
      developerId: body.developerId,
      groupId: body.groupId,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(201).json({ success: true, data: result.data, requestId: req.id });
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const result = await this.routingService.listByProject(req.user.projectId);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  toggle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as RoutingIdParams;
    const body = req.body as ToggleRuleBody;
    const result = await this.routingService.toggleRule({
      id,
      isActive: body.isActive,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res
      .status(200)
      .json({ success: true, data: { isActive: result.data.isActive }, requestId: req.id });
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as RoutingIdParams;
    const result = await this.routingService.deleteRule({
      id,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
