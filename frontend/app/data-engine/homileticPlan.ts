import { object, readField } from './fieldValues';
import { placementSteps } from './serviceOrderStepPlacement';

import type { RowDetailObservation, RowDetailPolicy } from './rowDetailAction';
import type { ConflictDetail, FieldChange, LabeledServiceOrderPlacement, ServiceOrderStepGap, ServiceOrderStepPlacement } from './types';

const isString = (value: unknown): value is string => typeof value === 'string';

export const homileticLists = ['updatedPlan', 'sermonPlan'] as const;
export type HomileticList = typeof homileticLists[number];

export const homileticListPath = (list: HomileticList) => ['preparation', 'homileticPlan', list];

/** Leave malformed or ambiguous legacy lists to the ordinary merge. */
export function readHomileticList(preparation: unknown, list: HomileticList) {
  if (!object(preparation)) return;
  const rows = placementSteps(readField(preparation, ['homileticPlan', list]).value);
  return rows?.every(row => row.id && typeof row.title === 'string') ? rows : undefined;
}

export const HOMILETIC_TITLE_REVIEW = 'homiletic-title-review';
export const HOMILETIC_POSITION_REVIEW = 'homiletic-position-review';
export const HOMILETIC_TITLE_PROJECTION = 'homiletic-title-projection';
export const HOMILETIC_POSITION_PROJECTION = 'homiletic-position-projection';

export function homileticComparisonList({ code, path }: Pick<ConflictDetail, 'code' | 'path'>): HomileticList | undefined {
  const list = homileticLists.find(key => key === path[2]);
  if (!list || path[0] !== 'preparation' || path[1] !== 'homileticPlan') return;
  if ((code === HOMILETIC_POSITION_REVIEW || code === HOMILETIC_POSITION_PROJECTION) && path.length === 3) return list;
  if (path.length !== 5 || !path[3].startsWith('id:')) return;
  if ((code === HOMILETIC_TITLE_REVIEW || code === HOMILETIC_TITLE_PROJECTION) && path[4] === 'title') return list;
}

/** Adapt one nested list to the engine's existing per-row title rule. */
export function homileticTitlePolicy(list: HomileticList): RowDetailPolicy<'title', string> {
  return {
    collection: 'sermons', fields: ['title'], repeatedFields: ['title'],
    birth: { field: list, leaf: 'id', accepts: isString },
    target: () => ({ field: list, leaf: 'title', accepts: isString }),
    proofs: `homiletic-${list}-title`, actions: 'homileticRowTitleActions',
    allowUnclocked: true, atomicChoice: true, rememberOpenings: true, history: homileticHistoryCollection(list),
  };
}

export type HomileticTitleActions = Partial<Record<HomileticList, RowDetailObservation<string>[]>>;

export function homileticTitleCommandChange(changes: FieldChange[], list: HomileticList): FieldChange | undefined {
  const change = changes.find(item => item.path[0] === 'preparation');
  const before = readHomileticList(change?.before.value, list), after = readHomileticList(change?.after.value, list);
  if (before && after) return { path: [list], before: { exists: true, value: before }, after: { exists: true, value: after } };
}

export type HomileticMoveInput = { homileticMove: { list: HomileticList; rowId: string } };
export type HomileticMoveGesture = HomileticMoveInput['homileticMove'] & { opening: ServiceOrderStepGap; destination: ServiceOrderStepGap; visibleOrder?: string[] };
export type HomileticPlacement = ServiceOrderStepPlacement & { queueId: string };
export type HomileticMoveActions = Partial<Record<HomileticList, HomileticPlacement[]>>;

export type HomileticPositionReviews = Partial<Record<HomileticList, number>>;

export const homileticHistoryCollection = (list: HomileticList) => `_${list}EditHistory`;

export type HomileticHistoryChange = { rowId: string; origin?: 'comparison' } & (
  | { kind: 'title'; earlier: string; kept: string }
  | { kind: 'position'; title?: string; earlier: LabeledServiceOrderPlacement; kept: LabeledServiceOrderPlacement }
);

export type HomileticHistoryPage = {
  owner: string;
  sermonId: string;
  generation: string;
  list: HomileticList;
  entries: { id: string; acceptedAt: string; changes: HomileticHistoryChange[] }[];
  nextCursor: string | null;
};
