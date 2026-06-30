import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type { IServiceRegistryService } from './registry.interfaces';
import type { ServiceIdParams, ServiceRuleBody } from './registry.schemas';

/**
 * Servis kayıt defteri HTTP katmanı (SRP: yalnızca request/response).
 * `projectId` body'den değil `req.user`'dan alınır → proje izolasyonu.
 * Tüm endpoint'ler yalnızca ADMIN'e açıktır (route'ta authorize ile).
 * Result açılır; hata ise `next`, değilse standart zarfla döner.
 */
export class ServiceRegistryController {
  constructor(private readonly service: IServiceRegistryService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const body = req.body as ServiceRuleBody;
    const result = await this.service.createRule({
      projectId: req.user.projectId,
      name: body.name,
      senderPattern: body.senderPattern,
      keywordPattern: body.keywordPattern,
      iconUrl: body.iconUrl,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(201).json({ success: true, data: result.data, requestId: req.id });
  };

  activate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as ServiceIdParams;
    const body = req.body as ServiceRuleBody;
    const result = await this.service.activateFromUnmatched({
      id,
      projectId: req.user.projectId,
      name: body.name,
      senderPattern: body.senderPattern,
      keywordPattern: body.keywordPattern,
      iconUrl: body.iconUrl,
    });
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

    const result = await this.service.listAll(req.user.projectId);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  listUnmatched = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const result = await this.service.listUnmatched(req.user.projectId);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as ServiceIdParams;
    const result = await this.service.deleteRule(id, req.user.projectId);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
