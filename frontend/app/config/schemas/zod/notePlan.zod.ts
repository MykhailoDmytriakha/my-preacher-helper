import { z } from 'zod';

import { PlanCueGroupSchema } from './planPointContent.zod';

/** Same cue/Scripture fields as thought-based plans, attributed by stable node id. */
export const NotePlanResponseSchema = z.object({
  nodes: z.array(PlanCueGroupSchema.pick({ cues: true, refs: true }).extend({
    nodeId: z.string(),
    turn: z.string().nullable(),
    missingMaterial: z.string().nullable(),
  })),
});
