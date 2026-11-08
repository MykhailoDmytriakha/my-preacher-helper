import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, DataEngineServerError, listServiceOrderTitleHistory, serverErrorResponse } from '@/data-engine/server';
import { withStore } from '@/services/storeAvailability.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ collection: string; id: string }> }): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const { collection, id } = await context.params;
    const params = new URL(request.url).searchParams;
    if (collection !== 'serviceOrders' || [...params.keys()].some(key => key !== 'generation' && key !== 'cursor')
      || params.getAll('generation').length !== 1 || params.getAll('cursor').length > 1) {
      throw new DataEngineServerError('invalid-argument', 400);
    }
    assertDataEngineEnabled(collection);
    const result = await withStore(() => listServiceOrderTitleHistory(owner, id, params.get('generation')!, params.get('cursor') ?? undefined), { startedAt });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
