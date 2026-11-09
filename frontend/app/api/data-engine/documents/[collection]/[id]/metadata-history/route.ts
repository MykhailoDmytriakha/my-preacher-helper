import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, DataEngineServerError, listAccountPreferenceHistory, listCouncilMetadataHistory, listPrayerStatusHistory, listSeriesMetadataHistory, listTagColorHistory, serverErrorResponse } from '@/data-engine/server';
import { withStore } from '@/services/storeAvailability.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const historyReaders = { councils: listCouncilMetadataHistory, prayerRequests: listPrayerStatusHistory, series: listSeriesMetadataHistory, tags: listTagColorHistory, users: listAccountPreferenceHistory };

export async function GET(request: Request, context: { params: Promise<{ collection: string; id: string }> }): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const { collection, id } = await context.params;
    const params = new URL(request.url).searchParams;
    if ((collection !== 'series' && collection !== 'councils' && collection !== 'prayerRequests' && collection !== 'tags' && collection !== 'users') || [...params.keys()].some(key => key !== 'generation' && key !== 'cursor')
      || params.getAll('generation').length !== 1 || params.getAll('cursor').length > 1) {
      throw new DataEngineServerError('invalid-argument', 400);
    }
    assertDataEngineEnabled(collection);
    const generation = params.get('generation')!, cursor = params.get('cursor') ?? undefined;
    const result = await withStore(async () => historyReaders[collection](owner, id, generation, cursor), { startedAt });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
