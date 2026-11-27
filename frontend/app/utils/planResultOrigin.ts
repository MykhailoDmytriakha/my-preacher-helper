import { z } from 'zod';

import { NotePlanResultSchema } from './notePlan';

export const PLAN_RESULT_OPENING_HEADER = 'x-plan-result-opening';
export const planResultMode = z.enum(['thoughts', 'note']);
export const planResultKey = z.string().regex(/^[a-f0-9]{64}$/);

export const planResultOrigin = z.object({
  sermonId: z.string().min(1),
  mode: planResultMode,
  pointId: z.string().min(1),
  targetNodeId: z.string().min(1).optional(),
  style: z.enum(['memory', 'narrative', 'exegetical']),
  openingKey: planResultKey,
  contextKey: planResultKey,
});

export type PlanResultOrigin = z.infer<typeof planResultOrigin>;
export type PlanResultMode = z.infer<typeof planResultMode>;

const readyPlanResult = z.discriminatedUnion('mode', [
  planResultOrigin.extend({ mode: z.literal('thoughts'), content: z.string() }),
  planResultOrigin.extend({ mode: z.literal('note'), proposal: NotePlanResultSchema }),
]);

const operation = z.object({ id: z.string().min(1), startedAtMs: z.number() });
export const planInboxItem = z.discriminatedUnion('state', [
  operation.extend({ state: z.literal('pending'), value: planResultOrigin }),
  operation.extend({ state: z.literal('ready'), value: readyPlanResult }),
]);
export const planInboxPage = z.object({ items: z.array(planInboxItem), next: z.string().optional(), closed: z.array(z.string()) });
export type PlanInboxItem = z.infer<typeof planInboxItem>;
