import 'openai/shims/node';

import { NextRequest, NextResponse } from 'next/server';

import { adminAuth } from '@/config/firebaseAdminConfig';
import { ComposePlanApiRequestSchema, ComposedPlanOutlineSchema } from '@/config/schemas/zod';
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

async function readComposeRequest(request: NextRequest) {
  try {
    const data = await request.json();
    const parsed = ComposePlanApiRequestSchema.safeParse(data);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

async function getAuthenticatedUid(request: NextRequest): Promise<string | null> {
  const token = getBearerToken(request);
  if (!token) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid || null;
  } catch (error) {
    console.error('compose-plan-from-scratch: invalid auth token', error);
    return null;
  }
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
    const { id: sermonId } = await params;

    if (!sermonId) {
      return jsonNoStore({ error: 'Sermon ID is required' }, { status: 400 });
    }

    const uid = await getAuthenticatedUid(request);
    if (!uid) {
      return jsonNoStore({ error: 'User not authenticated' }, { status: 401 });
    }

    const sermon = await sermonsRepository.fetchSermonById(sermonId);
    if (!sermon) {
      return jsonNoStore({ error: 'Sermon not found' }, { status: 404 });
    }

    if (sermon.userId !== uid) {
      return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }

    const requestBody = await readComposeRequest(request);
    const existingOutline = requestBody?.existingOutline ?? sermon.outline;
    const requestedScratchNoteIds = requestBody?.scratchNoteIds;
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
    const { outline, success } = await composePlanFromScratch(sermonForCompose, existingOutline);

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

    return jsonNoStore({ outline: parsedOutline.data });
  } catch (error: unknown) {
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
