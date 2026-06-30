import type { NextFunction, Request, Response } from 'express';
import { AuthenticationError } from '@errors/errors';
import type { IProjectService } from './project.interfaces';
import type {
  AddUserBody,
  CreateProjectBody,
  ProjectIdParams,
  RemoveUserParams,
} from './project.schemas';

/**
 * Proje HTTP katmanı (SRP: yalnızca request/response).
 * Result açılır; hata ise `next`, değilse standart zarfla döner.
 */
export class ProjectController {
  constructor(private readonly projectService: IProjectService) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body as CreateProjectBody;
    const result = await this.projectService.create({ name: body.name });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(201).json({ success: true, data: result.data, requestId: req.id });
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new AuthenticationError('Kimlik doğrulama gerekli'));
      return;
    }

    const { id } = req.params as unknown as ProjectIdParams;
    const result = await this.projectService.getById(id, req.user);
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  addUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { id } = req.params as unknown as ProjectIdParams;
    const body = req.body as AddUserBody;
    const result = await this.projectService.addUser({
      projectId: id,
      userId: body.userId,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };

  removeUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { id, uid } = req.params as unknown as RemoveUserParams;
    const result = await this.projectService.removeUser({
      projectId: id,
      userId: uid,
    });
    if (!result.success) {
      next(result.error);
      return;
    }
    res.status(200).json({ success: true, data: result.data, requestId: req.id });
  };
}
