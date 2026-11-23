import { z } from 'zod';

import { boundedActionTime } from './actionClock';

const id = z.string().min(1);
const actionTime = z.object({ earliestMs: z.number().int().safe().positive(), latestMs: z.number().int().safe().positive() })
  .refine(time => boundedActionTime(time) !== undefined).nullable();
const observedRevision = z.number().int().safe().nonnegative();
const serviceInputStamp = z.object({ time: actionTime, retainedOnly: z.literal(true).optional(), followsCaptured: z.literal(true).optional(), waitingForStep: z.literal(true).optional(),
  version: z.object({ generation: id, observedRevision: observedRevision.positive(), requestId: id.optional() }).optional() });
export const serviceOrderInputSchema = z.union([
  serviceInputStamp.extend({ field: z.literal('orderTitle'), before: z.string(), value: z.string(), raw: z.string().optional() }),
  serviceInputStamp.extend({ field: z.enum(['title', 'body']), stepId: id, before: z.string(), value: z.string() }),
  serviceInputStamp.extend({ field: z.literal('scriptureRefs'), stepId: id, before: z.array(z.string()), value: z.array(z.string()), raw: z.string() }),
]);
