import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, DataEngineServerError, readCollectionChanges, serverErrorResponse } from '@/data-engine/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ collection: string }> }): Promise<Response> {
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const { collection } = await context.params;
    assertDataEngineEnabled(collection);
    const params = new URL(request.url).searchParams;
    const after = params.get('after');
    const limit = params.get('limit');
    if ([...params.keys()].some(key => key !== 'after' && key !== 'limit') || params.getAll('after').length !== 1 || params.getAll('limit').length > 1
        || after === null || !/^\d+$/.test(after) || (limit !== null && !/^\d+$/.test(limit))) throw new DataEngineServerError('invalid-argument', 400);
    const result = await readCollectionChanges(owner, collection, Number(after), limit === null ? {} : { limit: Number(limit) });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return serverErrorResponse(error); }
}
