import 'server-only';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { withStore } from '@/services/storeAvailability.server';

import {
  assertDataEngineEnabled,
  DataEngineServerError,
  listCouncilAssemblyHistory,
  listCouncilTopicKindHistory,
  listCouncilTopicTitleHistory,
  listGroupFlowHistory,
  listServiceOrderFlagHistory,
  listServiceOrderStepTitleHistory,
  serverErrorResponse,
} from './server';

const histories = {
  groupBlockStatus: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'status') },
  groupBlockTitle: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'block') },
  groupStepTitle: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'step') },
  assembly: { collection: 'councils', list: listCouncilAssemblyHistory },
  topicKind: { collection: 'councils', list: listCouncilTopicKindHistory },
  topicTitle: { collection: 'councils', list: listCouncilTopicTitleHistory },
  stepFlag: { collection: 'serviceOrders', list: listServiceOrderFlagHistory },
  stepTitle: { collection: 'serviceOrders', list: listServiceOrderStepTitleHistory },
} as const;

export type RowHistory = keyof typeof histories;
export type RowHistoryContext = { params: Promise<{ collection: string; id: string }> };

export async function rowHistoryResponse(request: Request, context: RowHistoryContext, history: RowHistory): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const { collection, id } = await context.params;
    const params = new URL(request.url).searchParams;
    const selected = histories[history];
    if (collection !== selected.collection || [...params.keys()].some(key => key !== 'generation' && key !== 'cursor')
      || params.getAll('generation').length !== 1 || params.getAll('cursor').length > 1) {
      throw new DataEngineServerError('invalid-argument', 400);
    }
    assertDataEngineEnabled(collection);
    const generation = params.get('generation')!;
    const cursor = params.get('cursor') ?? undefined;
    const result = await withStore(async () => selected.list(owner, id, generation, cursor), { startedAt });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
