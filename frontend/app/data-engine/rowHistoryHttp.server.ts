import 'server-only';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { withStore } from '@/services/storeAvailability.server';

import {
  assertDataEngineEnabled,
  DataEngineServerError,
  listCommentKindHistory,
  listCouncilAssemblyHistory,
  listCouncilOutcomeHistory,
  listCouncilTopicKindHistory,
  listCouncilTopicTitleHistory,
  listDocumentTagHistory,
  listGroupFlowHistory,
  listExegeticalPointHistory,
  listSermonGoalTypeHistory,
  listSermonPlanModeHistory,
  listSermonPreparationConfirmationHistory,
  listSeriesMembershipHistory,
  listServiceOrderFlagHistory,
  listServiceOrderPlacementHistory,
  listServiceOrderStepPlacementHistory,
  listServiceOrderStepTitleHistory,
  listStudyNoteTypeHistory,
  listThoughtLockHistory,
  listThoughtPlacementHistory,
  listThoughtTagHistory,
  serverErrorResponse,
} from './server';

const histories = {
  groupStepDuration: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'duration') },
  groupBlockStatus: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'status') },
  groupBlockTitle: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'block') },
  groupStepTitle: { collection: 'groups', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listGroupFlowHistory(owner, id, generation, cursor, 'step') },
  assembly: { collection: 'councils', list: listCouncilAssemblyHistory },
  topicOutcome: { collection: 'councils', list: listCouncilOutcomeHistory },
  topicKind: { collection: 'councils', list: listCouncilTopicKindHistory },
  topicTitle: { collection: 'councils', list: listCouncilTopicTitleHistory },
  orderPlacement: { collection: 'serviceOrders', list: listServiceOrderPlacementHistory },
  stepPlacement: { collection: 'serviceOrders', list: listServiceOrderStepPlacementHistory },
  stepFlag: { collection: 'serviceOrders', list: listServiceOrderFlagHistory },
  stepTitle: { collection: 'serviceOrders', list: listServiceOrderStepTitleHistory },
  goalType: { collection: 'sermons', list: listSermonGoalTypeHistory },
  planMode: { collection: 'sermons', list: listSermonPlanModeHistory },
  exegeticalPoint: { collection: 'sermons', list: listExegeticalPointHistory },
  preparationConfirmation: { collection: 'sermons', list: listSermonPreparationConfirmationHistory },
  thoughtLock: { collection: 'sermons', list: listThoughtLockHistory },
  thoughtPlacement: { collection: 'sermons', list: listThoughtPlacementHistory },
  thoughtTag: { collection: 'sermons', list: listThoughtTagHistory },
  prayerTag: { collection: 'prayerRequests', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listDocumentTagHistory(owner, 'prayerRequests', id, generation, cursor) },
  commentKind: { collection: 'studyNotes', list: listCommentKindHistory },
  noteType: { collection: 'studyNotes', list: listStudyNoteTypeHistory },
  noteTag: { collection: 'studyNotes', list: (owner: string, id: string, generation: string, cursor?: string) =>
    listDocumentTagHistory(owner, 'studyNotes', id, generation, cursor) },
} as const;

export type RowHistory = keyof typeof histories | 'seriesMembership';
export type RowHistoryContext = { params: Promise<{ collection: string; id: string }> };

export async function rowHistoryResponse(request: Request, context: RowHistoryContext, history: RowHistory): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const { collection, id } = await context.params;
    const params = new URL(request.url).searchParams;
    const selected = history === 'seriesMembership' ? null : histories[history];
    const generations = params.getAll('generation');
    if ((selected ? collection !== selected.collection : collection !== 'sermons' && collection !== 'groups')
      || [...params.keys()].some(key => key !== 'generation' && key !== 'cursor')
      || (selected ? generations.length !== 1 : generations.length > 1) || params.getAll('cursor').length > 1) {
      throw new DataEngineServerError('invalid-argument', 400);
    }
    assertDataEngineEnabled(collection);
    const generation = params.get('generation');
    const cursor = params.get('cursor') ?? undefined;
    const result = await withStore(async () => selected
      ? selected.list(owner, id, generation!, cursor)
      : listSeriesMembershipHistory(owner, collection as 'sermons' | 'groups', id,
        generation === '' ? null : generation ?? undefined, cursor), { startedAt });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
