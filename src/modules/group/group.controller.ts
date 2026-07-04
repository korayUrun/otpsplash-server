import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type { IGroupService } from './group.interfaces';
import type {
  AddMemberBody,
  CreateGroupBody,
  GroupIdParams,
  RemoveMemberParams,
} from './group.schemas';

/**
 * Grup HTTP katmanı (SRP: yalnızca request/response).
 * `projectId` body'den değil `req.user`'dan alınır → proje izolasyonu.
 * Result açılır; hata ise `next`, değilse standart zarfla döner.
 */
export class GroupController {
  constructor(private readonly groupService: IGroupService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const body = req.body as CreateGroupBody;
    const result = await this.groupService.create({
      name: body.name,
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

    const result = await this.groupService.listForProject(req.user.projectId);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  addMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as GroupIdParams;
    const body = req.body as AddMemberBody;
    const result = await this.groupService.addMember({
      groupId: id,
      userId: body.userId,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  removeMember = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id, uid } = req.params as unknown as RemoveMemberParams;
    const result = await this.groupService.removeMember({
      groupId: id,
      userId: uid,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as GroupIdParams;
    const result = await this.groupService.delete({
      groupId: id,
      projectId: req.user.projectId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
