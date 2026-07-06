import { z } from 'zod';

export const ComposePlanSourceSchema = z.enum(['existing', 'ai', 'manual']);

export const ComposePlanPointSchema = z.object({
  scratchNoteId: z.string().min(1),
  outlinePointId: z.string().min(1).optional(),
  text: z.string().min(1),
  note: z.string().optional(),
});

export const ComposePlanSubPointSchema = ComposePlanPointSchema;

export const ComposedPlanSubPointSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  position: z.number(),
  note: z.string().optional(),
  scratchNoteId: z.string().min(1).optional(),
  source: ComposePlanSourceSchema.optional(),
});

export const ComposedPlanPointSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  note: z.string().optional(),
  isReviewed: z.boolean().optional(),
  subPoints: z.array(ComposedPlanSubPointSchema).optional(),
  scratchNoteId: z.string().min(1).optional(),
  source: ComposePlanSourceSchema.optional(),
});

export const ComposePlanResponseSchema = z.object({
  introduction: z.array(ComposePlanPointSchema),
  main: z.array(ComposePlanPointSchema),
  conclusion: z.array(ComposePlanPointSchema),
});

export const ComposedPlanOutlineSchema = z.object({
  introduction: z.array(ComposedPlanPointSchema),
  main: z.array(ComposedPlanPointSchema),
  conclusion: z.array(ComposedPlanPointSchema),
});

export const ComposePlanApiRequestSchema = z.object({
  existingOutline: ComposedPlanOutlineSchema.optional(),
  scratchNoteIds: z.array(z.string().min(1)).optional(),
}).optional();

export const ComposePlanApiResponseSchema = z.object({
  outline: ComposedPlanOutlineSchema,
});

export type ComposePlanSource = z.infer<typeof ComposePlanSourceSchema>;
export type ComposePlanSubPoint = z.infer<typeof ComposePlanSubPointSchema>;
export type ComposePlanPoint = z.infer<typeof ComposePlanPointSchema>;
export type ComposePlanResponse = z.infer<typeof ComposePlanResponseSchema>;
export type ComposedPlanSubPoint = z.infer<typeof ComposedPlanSubPointSchema>;
export type ComposedPlanPoint = z.infer<typeof ComposedPlanPointSchema>;
export type ComposedPlanOutline = z.infer<typeof ComposedPlanOutlineSchema>;
export type ComposePlanApiRequest = z.infer<typeof ComposePlanApiRequestSchema>;
export type ComposePlanApiResponse = z.infer<typeof ComposePlanApiResponseSchema>;
