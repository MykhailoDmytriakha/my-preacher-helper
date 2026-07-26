import 'openai/shims/node';

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { ComposePlanApiRequestSchema, ComposedPlanOutlineSchema } from '@/config/schemas/zod';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { composePlanFromScratch } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

type ComposeRequestRead =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; body: NonNullable<Awaited<ReturnType<typeof parseComposeBody>>> };

function parseComposeBody(data: unknown) {
  const parsed = ComposePlanApiRequestSchema.safeParse(data);
  return parsed.success ? parsed.data : undefined;
}

/**
 * A malformed body used to collapse into `undefined`, which the route read as "no subset
 * requested" and answered by composing EVERY scratch note. A version-skewed client could
 * therefore rearrange the whole sermon while believing it had asked about two notes.
 * Absent body stays legal (compose everything); a body that is present but unreadable is
 * now an error, because guessing what the caller meant is how silent damage happens.
 */
async function readComposeRequest(request: NextRequest): Promise<ComposeRequestRead> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { kind: 'invalid', reason: 'Request body could not be read' };
  }

  if (raw.trim().length === 0) return { kind: 'absent' };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'Request body is not valid JSON' };
  }

  const body = parseComposeBody(data);
  if (!body) return { kind: 'invalid', reason: 'Request body does not match the expected shape' };

  return { kind: 'ok', body };
}

/**
 * Guards on the requested subset. Each case used to fail SILENTLY:
 * an empty list answered 200 with the untouched outline, duplicates collapsed through a
 * Set, and a note deleted between the client's read and ours simply disappeared from the
 * composition — the preacher got a plan missing a thought he had explicitly asked about.
 */
function findSelectionProblem(
  requestedScratchNoteIds: string[] | undefined,
  scratch: Array<{ id: string }>
): { status: number; payload: Record<string, unknown> } | null {
  if (!requestedScratchNoteIds) return null;

  if (requestedScratchNoteIds.length === 0) {
    return { status: 400, payload: { error: 'scratchNoteIds must not be empty' } };
  }

  if (new Set(requestedScratchNoteIds).size !== requestedScratchNoteIds.length) {
    return { status: 400, payload: { error: 'scratchNoteIds must not contain duplicates' } };
  }

  const availableIds = new Set(scratch.map((note) => note.id));
  const missingScratchNoteIds = requestedScratchNoteIds.filter((id) => !availableIds.has(id));
  if (missingScratchNoteIds.length > 0) {
    return {
      status: 409,
      payload: { error: 'Some requested scratch notes no longer exist', missingScratchNoteIds },
    };
  }

  return null;
}

function collectScratchNoteIds(outline: unknown): string[] {
  const parsed = ComposedPlanOutlineSchema.safeParse(outline);
  if (!parsed.success) return [];

  return [
    ...parsed.data.introduction,
    ...parsed.data.main,
    ...parsed.data.conclusion,
  ].flatMap((point) => [
    point.scratchNoteId,
    ...(point.subPoints ?? []).map((subPoint) => subPoint.scratchNoteId),
  ]).filter((scratchNoteId): scratchNoteId is string => Boolean(scratchNoteId));
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) {
      return jsonNoStore({ error: 'User not authenticated' }, { status: 401 });
    }

    const { id: sermonId } = await params;

    if (!sermonId) {
      return jsonNoStore({ error: 'Sermon ID is required' }, { status: 400 });
    }

    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return jsonNoStore({ error: 'Sermon not found' }, { status: 404 });
    }

    if (sermon.userId !== uid) {
      return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }

    const read = await readComposeRequest(request);
    if (read.kind === 'invalid') {
      return jsonNoStore({ error: read.reason }, { status: 400 });
    }

    const requestBody = read.kind === 'ok' ? read.body : undefined;
    const existingOutline = requestBody?.existingOutline ?? sermon.outline;
    const requestedScratchNoteIds = requestBody?.scratchNoteIds;

    const selectionProblem = findSelectionProblem(requestedScratchNoteIds, sermon.scratch ?? []);
    if (selectionProblem) {
      return jsonNoStore(selectionProblem.payload, { status: selectionProblem.status });
    }

    const requestedScratchIdSet = requestedScratchNoteIds
      ? new Set(requestedScratchNoteIds)
      : null;
    const scratchForCompose = requestedScratchIdSet
      ? (sermon.scratch ?? []).filter((note) => requestedScratchIdSet.has(note.id))
      : (sermon.scratch ?? []);
    const sermonForCompose = requestedScratchIdSet
      ? { ...sermon, scratch: scratchForCompose }
      : sermon;
    const knownScratchIds = new Set(scratchForCompose.map((note) => note.id));
    const { outline, success, unplacedScratchNoteIds } = await composePlanFromScratch(
      sermonForCompose,
      existingOutline,
      uid
    );

    if (!success) {
      return jsonNoStore(
        { error: 'Failed to compose plan from scratch', outline: { introduction: [], main: [], conclusion: [] } },
        { status: 500 }
      );
    }

    const parsedOutline = ComposedPlanOutlineSchema.safeParse(outline);
    if (!parsedOutline.success) {
      return jsonNoStore({ error: 'Compose plan response failed validation' }, { status: 500 });
    }

    const unknownScratchIds = collectScratchNoteIds(parsedOutline.data).filter(
      (scratchNoteId) => !knownScratchIds.has(scratchNoteId)
    );
    if (unknownScratchIds.length > 0) {
      return jsonNoStore(
        { error: 'Compose plan returned unknown scratch ids', unknownScratchIds },
        { status: 500 }
      );
    }

    // Notes the model skipped are still in the outline, but the caller is told which ones
    // so the interface can say it out loud instead of quietly growing orphan points.
    return jsonNoStore({ outline: parsedOutline.data, unplacedScratchNoteIds });
  } catch (error: unknown) {
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    if (message === 'Sermon not found') {
      return jsonNoStore({ error: 'Sermon not found' }, { status: 404 });
    }

    console.error('Error composing plan from scratch:', error);
    return jsonNoStore(
      { error: `Failed to compose plan from scratch: ${message}` },
      { status: 500 }
    );
  }
}
