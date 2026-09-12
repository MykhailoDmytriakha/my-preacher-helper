import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * WHAT A COUNCIL IS ALLOWED TO BE when it arrives from a browser — a proposal, checked field by
 * field, never stored as sent. Sizes refuse rather than trim: a section handed back with its
 * explanation cut is worse than one that was not saved, because nothing says which words went.
 */
const questionSchema = z
  .object({
    id: z.string().min(1).max(64),
    question: z.string().max(2000),
    answer: z.string().max(5000).optional(),
  })
  .strict();

const optionSchema = z.object({ id: z.string().min(1).max(64), text: z.string().max(500) }).strict();

const changeSchema = z.object({ at: z.string().max(40), from: z.string().max(6000), to: z.string().max(6000) }).strict();

export const topicSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['decision', 'info']).optional(),
    title: z.string().max(300),
    summary: z.string().max(20000).optional(),
    questions: z.array(questionSchema).max(50),
    options: z.array(optionSchema).max(20),
    forAssembly: z.boolean().optional(),
    discussed: z.boolean().optional(),
    resolution: z.enum(['postponed', 'dropped']).optional(),
    acceptedOptionId: z.string().max(64).optional(),
    decision: z.string().max(2000).optional(),
    changes: z.array(changeSchema).max(200).optional(),
    carriedToCouncilId: z.string().max(64).optional(),
  })
  .strict();

/** The document without what only the server decides: `id`, `userId`, `rev`. */
export const councilBodySchema = z
  .object({
    title: z.string().max(200),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    status: z.enum(['preparing', 'held']),
    heldAt: z.string().max(40).optional(),
    topics: z
      .array(topicSchema)
      .max(100)
      .refine((topics) => new Set(topics.map((topic) => topic.id)).size === topics.length, 'Duplicate section id'),
    createdAt: z.string().max(40),
    updatedAt: z.string().max(40),
  })
  .strict();

export type CouncilBody = z.infer<typeof councilBodySchema>;

export function writeError(error: unknown) {
  const code = (error as { code?: string }).code;
  const status = code === 'not-found' ? 404 : code === 'permission-denied' ? 403 : 503;
  return NextResponse.json(
    { error: status === 404 ? 'Council not found' : status === 403 ? 'Forbidden' : 'Council write failed', code: code ?? 'unavailable' },
    { status }
  );
}

export const noStore = { 'Cache-Control': 'no-store' };
