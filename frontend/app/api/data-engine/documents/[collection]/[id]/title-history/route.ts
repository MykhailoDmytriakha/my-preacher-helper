import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, DataEngineServerError, listGroupTitleHistory, listPlanTemplateNameHistory, listPrayerTitleHistory, listSermonTitleHistory, listServiceOrderTitleHistory, listStudyNoteTitleHistory, serverErrorResponse } from '@/data-engine/server';
import { withStore } from '@/services/storeAvailability.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const titleHistory = { groups: listGroupTitleHistory, planTemplates: listPlanTemplateNameHistory, prayerRequests: listPrayerTitleHistory, sermons: listSermonTitleHistory, serviceOrders: listServiceOrderTitleHistory, studyNotes: listStudyNoteTitleHistory };

export async function GET(request: Request, context: { params: Promise<{ collection: string; id: string }> }): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const { collection, id } = await context.params;
    const params = new URL(request.url).searchParams;
    if ((collection !== 'serviceOrders' && collection !== 'groups' && collection !== 'sermons' && collection !== 'prayerRequests' && collection !== 'studyNotes' && collection !== 'planTemplates') || [...params.keys()].some(key => key !== 'generation' && key !== 'cursor')
      || params.getAll('generation').length !== 1 || params.getAll('cursor').length > 1) {
      throw new DataEngineServerError('invalid-argument', 400);
    }
    assertDataEngineEnabled(collection);
    const generation = params.get('generation')!, cursor = params.get('cursor') ?? undefined;
    const result = await withStore(async () => titleHistory[collection](owner, id, generation, cursor), { startedAt });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
