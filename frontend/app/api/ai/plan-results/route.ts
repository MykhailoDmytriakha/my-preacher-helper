import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { sermonsRepository } from '@/api/repositories/sermons.repository';
import { closePlanAiResult, listPlanAiResults, readClosedPlanAiResults, settlePlanAiResult } from '@/data-engine/aiOperations.server';
import { aiResultRecoveryRefusal } from '@/services/recoverableAiResult.server';
import { StoreUnavailableError, storeUnavailableResponse, withStore } from '@/services/storeAvailability.server';
import { storedNotePlanProposal } from '@/utils/notePlan';
import { storedPlanPointContent } from '@/utils/planPointMarkdown';
import { planInboxItem, planResultMode } from '@/utils/planResultOrigin';

export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function authorize(request: NextRequest) {
  const mode = planResultMode.safeParse(request.nextUrl.searchParams.get('mode'));
  if (!mode.success) return json({ error: 'Invalid plan mode' }, 400);
  const ownerId = await getRequiredAuthenticatedUid(request);
  if (!ownerId) return json({ error: 'Unauthorized' }, 401);
  const sermonId = request.nextUrl.searchParams.get('sermonId');
  if (!sermonId || sermonId.includes('/') || ['.', '..'].includes(sermonId)) return json({ error: 'Invalid sermon' }, 400);
  const sermon = await withStore(() => sermonsRepository.fetchSermonById(sermonId));
  if (!sermon || sermon.userId !== ownerId) return json({ error: 'Sermon not found' }, 404);
  return { ownerId, sermonId, mode: mode.data };
}

function failure(error: unknown) {
  const refusal = aiResultRecoveryRefusal(error);
  if (refusal) return json(refusal.body, refusal.status);
  if (error instanceof StoreUnavailableError) return storeUnavailableResponse(error);
  console.error('Could not read or update the plan result', error instanceof Error ? error.name : 'Unknown');
  return json({ error: 'Plan results unavailable' }, 500);
}

/** The plan landing reads scoped receipts. Only the explicit result check may settle one. */
export async function GET(request: NextRequest) {
  try {
    const scope = await authorize(request);
    if (scope instanceof Response) return scope;
    const search = request.nextUrl.searchParams;
    const known = search.getAll('known');
    if (known.length > 16) return json({ error: 'Too many operations' }, 400);
    if (search.get('statusOnly') === '1') {
      const closed = await withStore(() => readClosedPlanAiResults(scope.ownerId, scope.sermonId, scope.mode, known));
      return json({ closed, items: [] });
    }
    const { items, next, closed } = await withStore(() => listPlanAiResults(scope.ownerId, scope.sermonId, scope.mode,
      search.get('cursor') ?? undefined, known));
    return json({ next, closed, items: items.flatMap(({ id, record }) => {
      const plan = record.plan;
      if (!plan) return [];
      const base = { id, startedAtMs: record.startedAtMs };
      if (record.state !== 'settled' || !record.result) return [{ ...base, state: 'pending', value: plan }];
      const stored: unknown = JSON.parse(record.result.json);
      const value = plan.mode === 'note' ? { ...plan, proposal: storedNotePlanProposal(stored) }
        : { ...plan, content: storedPlanPointContent(stored) };
      return [planInboxItem.parse({ ...base, state: 'ready', value })];
    }) });
  } catch (error) {
    return failure(error);
  }
}

/** An explicit check of an existing operation is never a model request. */
export async function POST(request: NextRequest) {
  try {
    const scope = await authorize(request);
    if (scope instanceof Response) return scope;
    const id = request.nextUrl.searchParams.get('operationId');
    if (!id) return json({ error: 'Operation required' }, 400);
    const result = await withStore(() => settlePlanAiResult(scope.ownerId, scope.sermonId, scope.mode, id));
    return result ? json({ settled: true }) : json({ error: 'Result unavailable' }, 404);
  } catch (error) {
    return failure(error);
  }
}

/** Idempotently hide an offer after a decision. The charged receipt stays recoverable by its ID. */
export async function DELETE(request: NextRequest) {
  try {
    const scope = await authorize(request);
    if (scope instanceof Response) return scope;
    const id = request.nextUrl.searchParams.get('operationId');
    if (!id) return json({ error: 'Operation required' }, 400);
    const closed = await withStore(() => closePlanAiResult(scope.ownerId, scope.sermonId, scope.mode, id));
    return closed ? json({ closed: true }) : json({ error: 'Result unavailable' }, 404);
  } catch (error) {
    return failure(error);
  }
}
