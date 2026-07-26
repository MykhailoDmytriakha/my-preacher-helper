import { z } from 'zod';

export const ComposePlanSourceSchema = z.enum(['existing', 'ai', 'manual']);

export const ComposePlanSectionSchema = z.enum(['introduction', 'main', 'conclusion']);

export const ComposePlanTargetKindSchema = z.enum(['new_point', 'existing_point']);

/**
 * AI RESPONSE CONTRACT — deliberately flat, every field required.
 *
 * Two measured failures shaped this schema (2026-07-26):
 *
 * 1. `.optional()` here used to compile into a SELF-REFERENTIAL JSON Schema —
 *    `{"anyOf":[{"not":{}},{"$ref":"#/definitions/<itself>"}]}`. Gemini cannot build a
 *    constrained-decoding grammar over that cycle: it ground for 84-110s and answered
 *    `500 (no body)`, which Vercel surfaced as FUNCTION_INVOCATION_TIMEOUT.
 *    Same prompt/model/data: cyclic 107.8s → 500 · flat 12.7s → success.
 *    So: NO `.optional()` in this file. Absence is expressed by an empty string or an
 *    empty array, never by a missing key.
 *
 * 2. Notes are addressed by SHORT KEYS (`n1`..`nN`), never by UUID. When the prompt fed
 *    UUIDs, the model echoed the list ordinal instead ("20"), and `findUnknownScratchIds`
 *    discarded the ENTIRE response — 25 of 25 ids wrong in 4 of 5 runs. Short keys remove
 *    the class: the model never sees a UUID, so it cannot mangle one.
 *
 * Dropping the raw-text echo is the same change: the model returned 5287 characters that
 * were byte-for-byte the notes we had just sent it. The server owns that text.
 */
export const ComposePlanPlacementSchema = z.object({
  /** Short key of the scratch note being placed, e.g. "n7". */
  noteKey: z.string().min(1),
  /** Short outline-style heading the model writes for this note. */
  text: z.string(),
  /** Section the model proposes. Manual pins and explicit cues still win server-side. */
  section: ComposePlanSectionSchema,
  targetKind: ComposePlanTargetKindSchema,
  /** Short key of an existing outline point ("p3") when targetKind is existing_point, else "". */
  targetKey: z.string(),
});

export const ComposePlanUnplacedSchema = z.object({
  noteKey: z.string().min(1),
  reasonCode: z.string(),
});

export const ComposePlanResponseSchema = z.object({
  placements: z.array(ComposePlanPlacementSchema),
  unplaced: z.array(ComposePlanUnplacedSchema),
});

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
  unplacedScratchNoteIds: z.array(z.string()).optional(),
});

export type ComposePlanSource = z.infer<typeof ComposePlanSourceSchema>;
export type ComposePlanSection = z.infer<typeof ComposePlanSectionSchema>;
export type ComposePlanTargetKind = z.infer<typeof ComposePlanTargetKindSchema>;
export type ComposePlanPlacement = z.infer<typeof ComposePlanPlacementSchema>;
export type ComposePlanUnplaced = z.infer<typeof ComposePlanUnplacedSchema>;
export type ComposePlanResponse = z.infer<typeof ComposePlanResponseSchema>;
export type ComposedPlanSubPoint = z.infer<typeof ComposedPlanSubPointSchema>;
export type ComposedPlanPoint = z.infer<typeof ComposedPlanPointSchema>;
export type ComposedPlanOutline = z.infer<typeof ComposedPlanOutlineSchema>;
export type ComposePlanApiRequest = z.infer<typeof ComposePlanApiRequestSchema>;
export type ComposePlanApiResponse = z.infer<typeof ComposePlanApiResponseSchema>;
