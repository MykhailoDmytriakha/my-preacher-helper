import 'openai/shims/node';

import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { AiResultUnavailableError } from '@/api/errors/aiResultRecovery.server';
import { usageCapResponse } from '@/api/errors/usageCapResponse';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { ThoughtInStructure } from '@/models/models';
import { AI_RESULT_RESPONSE_BUDGET_MS, aiResultRecoveryForRequest, aiResultRecoveryRefusal } from '@/services/recoverableAiResult.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import { isUsageCapReachedError } from '@/services/usageLimits';
import { AI_RESULT_NOT_STARTED, AI_RESULT_OPERATION_HEADER, AI_RESULT_RECOVERY_ONLY_HEADER } from '@/utils/aiResultOperation';
import { requestLanguage } from '@/utils/appLocale';
import { getVisualOrderedThoughtsForOutlinePoint } from '@/utils/sermonVisualOrder';
import { buildSubPointRenderableEntries, flattenSubPointRenderableEntries, normalizeSubPointId } from '@/utils/subPoints';
import { generatePlanPointContent, recoverPlanPointContent, PlanStyle } from '@clients/openAI.client';
import { sermonsRepository } from '@repositories/sermons.repository';

import { handleNotePlanProposal, NotePlanRefusal } from './notePlanProposal.server';

export const dynamic = 'force-dynamic';
const PLAN_POINT_MODEL_BUDGET_MS = 45_000;

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });
  return NextResponse.json(body, { ...init, headers });
}

// Error message constants
const ERROR_MESSAGES = {
  UNKNOWN_ERROR: 'Unknown error occurred',
  SERMON_NOT_FOUND: 'Sermon not found',
} as const;

// Use the SermonContent interface from models.ts

// GET /api/sermons/:id/plan?section=introduction|main|conclusion - generates plan for specific section
// GET /api/sermons/:id/plan?outlinePointId=<id> - generates content for a specific outline point
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = performance.now();
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) {
    return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const section = request.nextUrl.searchParams.get('section');
  const outlinePointId = request.nextUrl.searchParams.get('outlinePointId');
  const style = request.nextUrl.searchParams.get('style') as PlanStyle | null;

  console.log('GET /api/sermons/:id/plan - section:', section, 'outlinePointId:', outlinePointId, 'style:', style);

  // If outlinePointId is provided, generate content for the specific outline point
  if (outlinePointId) {
    return generateSermonPointContent(request, id, outlinePointId, uid, style || 'memory', startedAt);
  }

  // A whole section generated and SAVED here is the legacy write road; only shipped bundles ask for
  // it. The plan is written only through the data engine, so it gets the 426 refusal.
  return refuseLegacyWriteRoute(request);
}

// Helper function to generate content for a specific outline point
async function generateSermonPointContent(
  request: NextRequest,
  sermonId: string,
  outlinePointId: string,
  uid: string,
  style: PlanStyle,
  startedAt: number,
) {
  try {
    const operation = request.headers?.has(AI_RESULT_OPERATION_HEADER) ? aiResultRecoveryForRequest(request, {
      ownerId: uid,
      source: ['sermon-plan-point-v1', sermonId, outlinePointId, style],
      deadline: startedAt + AI_RESULT_RESPONSE_BUDGET_MS,
    }) : undefined;
    // Fetch the sermon
    const sermon = await withStore(() => sermonsRepository.fetchSermonById(sermonId));
    if (!sermon) {
      return jsonNoStore({ error: ERROR_MESSAGES.SERMON_NOT_FOUND }, { status: 404 });
    }
    if (sermon.userId !== uid) {
      return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }
    if (request.headers?.get(AI_RESULT_RECOVERY_ONLY_HEADER) === '1') {
      if (!operation) return jsonNoStore({ error: 'An operation ID is required to recover a plan result' }, { status: 400 });
      return jsonNoStore({ content: await recoverPlanPointContent(operation.recovery) });
    }

    // Find the outline point in the sermon structure
    let outlinePoint;
    let sectionName;

    if (sermon.outline?.introduction.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.introduction.find(op => op.id === outlinePointId);
      sectionName = 'introduction';
    } else if (sermon.outline?.main.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.main.find(op => op.id === outlinePointId);
      sectionName = 'main';
    } else if (sermon.outline?.conclusion.some(op => op.id === outlinePointId)) {
      outlinePoint = sermon.outline.conclusion.find(op => op.id === outlinePointId);
      sectionName = 'conclusion';
    }

    if (!outlinePoint || !sectionName) {
      return jsonNoStore(
        { error: 'SermonOutline point not found in sermon structure' },
        { status: 404 }
      );
    }

    // Find thoughts related to this outline point in the shared visual order.
    const relatedThoughts = getVisualOrderedThoughtsForOutlinePoint(sermon, outlinePointId);

    if (relatedThoughts.length === 0) {
      return jsonNoStore(
        { error: 'No thoughts associated with this outline point' },
        { status: 400 }
      );
    }

    const relatedThoughtsForPrompt = flattenSubPointRenderableEntries(
      buildSubPointRenderableEntries<ThoughtInStructure>(
        relatedThoughts.map((thought) => ({
          id: thought.id,
          content: thought.text,
          position: thought.position,
          subPointId: normalizeSubPointId(thought.subPointId, outlinePoint.subPoints),
        })),
        outlinePoint.subPoints
      )
    );
    const keyFragments = relatedThoughts.reduce((acc: string[], thought) => {
      if (thought.keyFragments && thought.keyFragments.length > 0) {
        return acc.concat(thought.keyFragments);
      }
      return acc;
    }, []);

    // Fetch adjacent outline points for context
    const adjacentContext = await sermonsRepository.fetchAdjacentOutlinePoints(sermonId, outlinePointId);

    // Generate the content using the AI client
    const { content, success } = await generatePlanPointContent(
      sermon.title,
      sermon.verse,
      outlinePoint.text,
      relatedThoughtsForPrompt,
      sectionName,
      keyFragments, // Pass combined key fragments
      adjacentContext || undefined, // Pass context if available
      style,
      outlinePoint.subPoints, // Pass sub-points for structured generation
      uid,
      ...(operation ? [{ recovery: operation.recovery, deadline: startedAt + PLAN_POINT_MODEL_BUDGET_MS }] as const : []),
    );

    if (!success) {
      return jsonNoStore(
        { error: 'Failed to generate content for outline point', ...(operation && { operationEnded: true }) },
        { status: 500 }
      );
    }

    return jsonNoStore({ content });
  } catch (error: unknown) {
    if (error instanceof AiResultUnavailableError && error.reason === 'missing') {
      return jsonNoStore({ code: AI_RESULT_NOT_STARTED, error: 'The plan generation has not registered yet' }, { status: 409 });
    }
    const recoveryFailure = aiResultRecoveryRefusal(error);
    if (recoveryFailure) return jsonNoStore(recoveryFailure.body, { status: recoveryFailure.status });
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    console.error(`Error generating content for outline point ${outlinePointId}:`, error);
    return jsonNoStore(
      { error: 'Failed to generate content', details: (error as Error).message },
      { status: 500 }
    );
  }
}

/** Generate a note-backed proposal. Only the editor can accept and save the text. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  try {
    return jsonNoStore(await handleNotePlanProposal(request, uid, id, requestLanguage(request), startedAt));
  } catch (error) {
    if (error instanceof NotePlanRefusal) return jsonNoStore({ error: error.message }, { status: error.status });
    if (error instanceof AiResultUnavailableError && error.reason === 'missing') {
      return jsonNoStore({ code: AI_RESULT_NOT_STARTED, error: 'The plan generation has not registered yet' }, { status: 409 });
    }
    const recoveryFailure = aiResultRecoveryRefusal(error);
    if (recoveryFailure) return jsonNoStore(recoveryFailure.body, { status: recoveryFailure.status });
    if (isUsageCapReachedError(error)) return usageCapResponse(error);
    if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
    if (error instanceof SyntaxError) return jsonNoStore({ error: 'Invalid request' }, { status: 400 });
    console.error('Note plan generation failed', error);
    return jsonNoStore({ error: 'generationFailed' }, { status: 500 });
  }
}

/** PUT stays for shipped bundles: the plan text is written only through the data engine (426 refusal). */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}
