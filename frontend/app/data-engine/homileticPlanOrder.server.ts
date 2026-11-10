import { documentProofHeadroom } from './documentProofBudget.server';
import { equalValues, object, writeField } from './fieldValues';
import { homileticCrossingProofKey, metadataAfterHomileticCrossings } from './homileticCrossings.server';
import { homileticPlacementProofKey, homileticPlacementTracking, planHomileticMoves, type HomileticMoveWrite } from './homileticPlacement.server';
import { homileticListPath, homileticLists, homileticTitleCommandChange, homileticTitlePolicy, HOMILETIC_POSITION_PROJECTION, HOMILETIC_POSITION_REVIEW, HOMILETIC_TITLE_PROJECTION, HOMILETIC_TITLE_REVIEW, readHomileticList } from './homileticPlan';
import { metadataAfterRowDetails, needsLegacyRowDetailOpeningReview, orderRowDetails, readRowDetailProof, rowDetailPreviousValues } from './rowDetailOrder.server';
import { readRowObservation } from './rowFieldOrder.server';
import { retainedStepOrderChanged } from './serviceOrderStepPlacement';

import type { HomileticList } from './homileticPlan';
import type { RowDetailPolicy } from './rowDetailAction';
import type { RowDetailOrder } from './rowDetailOrder.server';
import type { ConflictDetail, DataCommand, DocumentData, EngineMetadata, FieldChange, ResourceSnapshot } from './types';

const layoutId = 'layout';
const isString = (value: unknown): value is string => typeof value === 'string';
const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const rowsIds = (rows: readonly { id: string }[]) => rows.map(row => row.id);

type Rows = NonNullable<ReturnType<typeof readHomileticList>>;
type Frame = 'title' | 'order';

function layoutPolicy(list: HomileticList): RowDetailPolicy<'order', string[]> {
  return {
    collection: 'sermons', fields: ['order'], birth: { field: list, leaf: 'id', accepts: isString },
    target: () => ({ field: list, leaf: 'order', accepts: isIds }), proofs: `homiletic-${list}-order`,
    actions: '', rememberOpenings: true, history: '',
  };
}

type TitleOrder = RowDetailOrder<'title', string>;
type Update = Extract<DataCommand, { kind: 'update' }>;

export function homileticTitleSnapshot(snapshot: ResourceSnapshot, list: HomileticList): ResourceSnapshot {
  return { ...snapshot, value: frameRows(list, readHomileticList(snapshot.value?.preparation, list), 'title') };
}

function frameRows(list: HomileticList, rows: Rows | undefined, frame: Frame): DocumentData {
  return rows === undefined ? {} : { [list]: frame === 'title' ? rows : [{ id: layoutId, order: rowsIds(rows) }] };
}

/** Read the shared row history against the two nested, independent lists. */
export function metadataAfterHomileticPlans(snapshot: ResourceSnapshot, raw: Record<string, unknown> | undefined, order?: HomileticOrder) {
  if (snapshot.resource.collection !== 'sermons' || !snapshot.metadata || !snapshot.value) return snapshot.metadata;
  const beforeMetadata = raw?._dataEngine;
  let metadata = snapshot.metadata;
  for (const list of homileticLists) {
    const rows = readHomileticList(snapshot.value.preparation, list);
    if (!rows) continue;
    const before = readHomileticList(raw?.preparation, list);
    const rawTitle = { ...frameRows(list, before, 'title'), _dataEngine: beforeMetadata };
    const rawLayout = { ...frameRows(list, before, 'order'), _dataEngine: beforeMetadata };
    const current = { ...snapshot, value: frameRows(list, rows, 'title') };
    metadata = metadataAfterRowDetails({ ...current, metadata }, rawTitle, homileticTitlePolicy(list), order?.titles.get(list)) ?? metadata;
    metadata = homileticPlacementTracking(list).metadataAfter({ ...current, metadata }, rawTitle, order?.moves.get(list)?.writes) ?? metadata;
    metadata = { ...metadata, ...metadataAfterHomileticCrossings(beforeMetadata, list, metadata.revision, rows, order?.moves.get(list)?.crossings) };
    metadata = metadataAfterRowDetails({ ...snapshot, metadata, value: frameRows(list, rows, 'order') }, rawLayout, layoutPolicy(list)) ?? metadata;
  }
  return metadata;
}

/** Discard detailed evidence under document pressure. Its floor still makes older writes ask. */
export function boundHomileticMetadata(value: Record<string, unknown>, metadata: EngineMetadata | null | undefined) {
  if (!metadata) return metadata;
  const stored = metadata as EngineMetadata & Record<string, unknown>;
  const tracked = homileticLists.filter(list => homileticPlacementProofKey(list) in stored);
  if (!tracked.length || documentProofHeadroom(value, metadata) >= 0) return metadata;
  const bounded = { ...stored };
  const floor = metadata.revision;
  const empty = { floor, proofs: [] };
  for (const list of tracked) {
    bounded[homileticTitlePolicy(list).proofs] = { title: empty };
    bounded[layoutPolicy(list).proofs] = { order: empty };
    bounded[homileticCrossingProofKey(list)] = empty;
    const key = homileticPlacementProofKey(list);
    const placement = stored[key];
    if (object(placement)) bounded[key] = { head: placement.head, guardLegacy: placement.guardLegacy === true, floor, moves: [], births: [] };
  }
  return bounded;
}

function titleReturns(list: HomileticList, before: Rows, mine: Rows, stored: Rows, raw: unknown, revision: number, observed: ReadonlySet<string>): ConflictDetail[] {
  const original = new Map(before.map(row => [row.id, row.title]));
  const saved = new Map(stored.map(row => [row.id, row.title]));
  return mine.flatMap(row => {
    const opening = original.get(row.id);
    if (observed.has(row.id) || typeof opening !== 'string' || typeof row.title !== 'string' || opening.trim() === row.title.trim()
      || opening !== saved.get(row.id) || !needsLegacyRowDetailOpeningReview(raw, homileticTitlePolicy(list), 'title', row.id, row.id, opening, revision)) return [];
    return [{ path: [...homileticListPath(list), 'id:' + row.id, 'title'], code: HOMILETIC_TITLE_REVIEW,
      base: { exists: true, value: opening }, mine: { exists: true, value: row.title }, theirs: { exists: true, value: opening } }];
  });
}

function positionComparison(list: HomileticList, before: Rows, mine: Rows, stored: Rows): ConflictDetail {
  return { path: homileticListPath(list), code: HOMILETIC_POSITION_REVIEW,
    base: { exists: true, value: before }, mine: { exists: true, value: mine }, theirs: { exists: true, value: stored } };
}

function checkedPositionReview(observed: number, list: HomileticList, before: Rows, stored: Rows, raw: unknown, revision: number) {
  if (!Number.isSafeInteger(observed) || observed <= 0 || observed > revision || !equalValues(rowsIds(before), rowsIds(stored))) return false;
  if (observed === revision) return true;
  const proof = readRowDetailProof(raw, layoutPolicy(list), 'order', layoutId, layoutId, rowsIds(stored), undefined, revision);
  return Boolean(proof && proof.revision <= observed);
}

function positionReturn(list: HomileticList, before: Rows, mine: Rows, stored: Rows, raw: unknown, revision: number): ConflictDetail | undefined {
  if (!retainedStepOrderChanged(before, mine) || !retainedStepOrderChanged(stored, mine)) return;
  const original = rowsIds(before), live = rowsIds(stored);
  const target = layoutPolicy(list);
  const sameRetainedOrder = !retainedStepOrderChanged(before, stored);
  const unknownOpening = sameRetainedOrder && needsLegacyRowDetailOpeningReview(raw, target, 'order', layoutId, layoutId, live, revision);
  const returned = unknownOpening || (!equalValues(original, live)
    && rowDetailPreviousValues(raw, target, 'order', layoutId, layoutId, live, revision)?.(original));
  if (returned) return positionComparison(list, before, mine, stored);
}

function observeTitles(command: Update, list: HomileticList, change: FieldChange, revision: number, serverMs: number) {
  const submitted = command.homileticTitleActions?.[list];
  const byId = new Map<string, unknown>();
  if (Array.isArray(submitted)) for (const raw of submitted) {
    if (!object(raw) || raw.rowCreatedAt !== raw.rowId) continue;
    const action = readRowObservation({ ...command, changes: [change] }, raw, homileticTitlePolicy(list).target('title'), serverMs,
      { allowUnclocked: true });
    if (!action || action.observedRevision > revision) continue;
    byId.set(action.rowId, byId.has(action.rowId) ? undefined : raw);
  }
  return new Map([...byId].filter(([, action]) => action !== undefined));
}

function withOrderedList(change: FieldChange, list: HomileticList, projected: FieldChange): FieldChange {
  if (!object(change.before.value) || !object(change.after.value)) return change;
  const path = homileticListPath(list).slice(1);
  return { ...change, before: { ...change.before, value: writeField(change.before.value, path, projected.before) },
    after: { ...change.after, value: writeField(change.after.value, path, projected.after) } };
}

function titleReviewResults(list: HomileticList, submitted: Rows, ordered: TitleOrder | undefined) {
  const path = homileticListPath(list);
  const uncertain: ConflictDetail[] = ordered?.uncertain.map(conflict => ({ ...conflict, path: [...path, ...conflict.path.slice(1)], code: HOMILETIC_TITLE_REVIEW })) ?? [];
  const settled: ConflictDetail[] = ordered?.displaced.flatMap(entry => {
    const authored = submitted.find(row => row.id === entry.rowId);
    if (!authored) return [];
    const winner = { exists: true, value: entry.winnerValue };
    return [{ path: [...path, 'id:' + entry.rowId, 'title'], code: HOMILETIC_TITLE_PROJECTION,
      base: { exists: true, value: authored.title }, mine: winner, theirs: winner }];
  }) ?? [];
  return { uncertain, settled };
}

function orderHomileticList(command: Update, list: HomileticList, change: FieldChange, current: ResourceSnapshot, raw: unknown,
  revision: number, serverMs: number) {
  const localChange = homileticTitleCommandChange([change], list);
  const stored = readHomileticList(current.value?.preparation, list);
  const before = readHomileticList(change.before.value, list), mine = readHomileticList(change.after.value, list);
  if (!localChange || !stored || !before || !mine) return;
  const snapshot = homileticTitleSnapshot(current, list);
  const observations = observeTitles(command, list, localChange, revision, serverMs);
  const localCommand = { ...command, changes: [localChange], homileticRowTitleActions: [...observations.values()] };
  const titles = observations.size ? orderRowDetails(localCommand, snapshot, raw, serverMs, homileticTitlePolicy(list)) : undefined;
  const titled = titles?.command.kind === 'update' ? titles.command.changes[0] : localChange;
  const placement = planHomileticMoves(command, list, localChange, snapshot, raw, serverMs, titled);
  const reviews = titleReviewResults(list, mine, titles);
  reviews.uncertain.push(...titleReturns(list, before, mine, stored, raw, revision, new Set(observations.keys())));
  const reviewed = command.homileticPositionReviews?.[list];
  const position = placement ? ('conflict' in placement ? placement.conflict : undefined)
    : reviewed === undefined ? positionReturn(list, before, mine, stored, raw, revision)
      : checkedPositionReview(reviewed, list, before, stored, raw, revision) ? undefined
        : positionComparison(list, before, mine, stored);
  if (position) reviews.uncertain.push(position);
  const moves = placement && 'writes' in placement ? placement : undefined;
  if (moves) reviews.settled.push({ ...positionComparison(list, before, moves.order, moves.order), code: HOMILETIC_POSITION_PROJECTION });
  const projected = moves?.change ?? titled;
  return { ...reviews, titles, moves, change: projected !== localChange ? projected : undefined };
}

type HomileticOrder = { command: DataCommand; uncertain: ConflictDetail[]; settled: ConflictDetail[]; titles: Map<HomileticList, TitleOrder>; moves: Map<HomileticList, HomileticMoveWrite> };

export function orderHomileticPlans(command: DataCommand, current: ResourceSnapshot, raw: unknown, serverMs: number): HomileticOrder {
  const metadata = current.metadata;
  const titles = new Map<HomileticList, TitleOrder>();
  const moves = new Map<HomileticList, HomileticMoveWrite>();
  const uncertain: ConflictDetail[] = [];
  const settled: ConflictDetail[] = [];
  const result = { command, uncertain, settled, titles, moves };
  if (command.kind !== 'update' || current.resource.collection !== 'sermons' || !metadata || metadata.deleted
    || command.generation !== metadata.generation) return result;
  const change = command.changes.find(item => item.path[0] === 'preparation');
  if (!change) return result;
  let projected = change;
  for (const list of homileticLists) {
    const ordered = orderHomileticList(command, list, change, current, raw, metadata.revision, serverMs);
    if (!ordered) continue;
    if (ordered.change) projected = withOrderedList(projected, list, ordered.change);
    if (ordered.titles) titles.set(list, ordered.titles);
    if (ordered.moves) moves.set(list, ordered.moves);
    uncertain.push(...ordered.uncertain);
    settled.push(...ordered.settled);
  }
  if (projected !== change) result.command = { ...command, changes: command.changes.map(item => item === change ? projected : item) };
  return result;
}
