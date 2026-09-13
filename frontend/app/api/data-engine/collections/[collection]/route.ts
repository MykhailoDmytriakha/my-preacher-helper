import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, DataEngineServerError, listDocuments, serverErrorResponse } from '@/data-engine/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ collection: string }> }): Promise<Response> {
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    assertDataEngineEnabled();
    const { collection } = await context.params;
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'limit' && key !== 'cursor') || params.getAll('limit').length > 1 || params.getAll('cursor').length > 1) {
      throw new DataEngineServerError('invalid-argument', 400);
    }
    const limit = params.get('limit');
    const cursor = params.get('cursor');
    if (limit !== null && !/^\d+$/.test(limit)) throw new DataEngineServerError('invalid-argument', 400);
    const result = await listDocuments(owner, collection, { ...(limit !== null ? { limit: Number(limit) } : {}), ...(cursor !== null ? { cursor } : {}) });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
