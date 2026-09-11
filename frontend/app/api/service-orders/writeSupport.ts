import { NextResponse } from 'next/server';
import { z } from 'zod';

export const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string().optional(),
  scriptureRefs: z.array(z.string()).optional(),
  flagged: z.boolean().optional(),
}).strict();
export const stepsSchema = z.array(stepSchema).refine(
  steps => new Set(steps.map(step => step.id)).size === steps.length,
  'Duplicate step id'
);

export function writeError(error: unknown) {
  const code = (error as { code?: string }).code;
  const status = code === 'not-found' ? 404 : code === 'permission-denied' ? 403 : 503;
  return NextResponse.json({ error: status === 404 ? 'Service order not found' : 'Service order write failed', code: code ?? 'unavailable' }, { status });
}

export const noStore = { 'Cache-Control': 'no-store' };
