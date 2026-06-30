import { z } from 'zod';

/** Grup adı üst sınırı — DB şemasındaki VarChar(100) ile hizalı. */
const MAX_NAME_LENGTH = 100;

/** `POST /api/groups` gövdesi. `projectId` body'de YOKTUR — admin'in projesinden alınır. */
export const createGroupSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
});

/** `:id` (grup) path parametresi. */
export const groupIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/** `POST /api/groups/:id/members` gövdesi. */
export const addMemberSchema = z.object({
  userId: z.string().uuid(),
});

/** `DELETE /api/groups/:id/members/:uid` path parametreleri. */
export const removeMemberParamsSchema = z.object({
  id: z.string().uuid(),
  uid: z.string().uuid(),
});

export type CreateGroupBody = z.infer<typeof createGroupSchema>;
export type GroupIdParams = z.infer<typeof groupIdParamsSchema>;
export type AddMemberBody = z.infer<typeof addMemberSchema>;
export type RemoveMemberParams = z.infer<typeof removeMemberParamsSchema>;
