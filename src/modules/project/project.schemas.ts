import { z } from 'zod';

/** Proje adı üst sınırı — DB şemasındaki VarChar(100) ile hizalı. */
const MAX_NAME_LENGTH = 100;

/** `POST /api/projects` gövdesi. */
export const createProjectSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
});

/** `GET /api/projects/:id` ve `POST /api/projects/:id/users` path parametreleri. */
export const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/** `POST /api/projects/:id/users` gövdesi. */
export const addUserSchema = z.object({
  userId: z.string().uuid(),
});

/** `DELETE /api/projects/:id/users/:uid` path parametreleri. */
export const removeUserParamsSchema = z.object({
  id: z.string().uuid(),
  uid: z.string().uuid(),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>;
export type AddUserBody = z.infer<typeof addUserSchema>;
export type RemoveUserParams = z.infer<typeof removeUserParamsSchema>;
