import { z } from 'zod';
import { RoutingTarget } from '@prisma/client';

/**
 * `POST /api/routing-rules` gövdesi.
 * `projectId` body'de YOKTUR — admin'in projesinden alınır. Servis kavramı yoktur.
 * Hedef tutarlılığı refine ile zorlanır: DEVELOPER → developerId zorunlu & groupId yasak;
 * GROUP → groupId zorunlu & developerId yasak.
 */
export const createRoutingRuleSchema = z
  .object({
    receiverId: z.string().uuid(),
    targetType: z.nativeEnum(RoutingTarget),
    developerId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.targetType === RoutingTarget.DEVELOPER) {
      if (!data.developerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetType=DEVELOPER için developerId zorunlu',
          path: ['developerId'],
        });
      }
      if (data.groupId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetType=DEVELOPER iken groupId verilemez',
          path: ['groupId'],
        });
      }
    } else {
      if (!data.groupId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetType=GROUP için groupId zorunlu',
          path: ['groupId'],
        });
      }
      if (data.developerId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'targetType=GROUP iken developerId verilemez',
          path: ['developerId'],
        });
      }
    }
  });

/** `:id` (kural) path parametresi. */
export const routingIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/** `PATCH /api/routing-rules/:id` gövdesi. */
export const toggleRuleSchema = z.object({
  isActive: z.boolean(),
});

export type CreateRoutingRuleBody = z.infer<typeof createRoutingRuleSchema>;
export type RoutingIdParams = z.infer<typeof routingIdParamsSchema>;
export type ToggleRuleBody = z.infer<typeof toggleRuleSchema>;
