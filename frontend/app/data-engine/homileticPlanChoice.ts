import { equalValues, writeField } from './fieldValues';
import { homileticComparisonList, homileticListPath, HOMILETIC_POSITION_PROJECTION, HOMILETIC_POSITION_REVIEW, HOMILETIC_TITLE_PROJECTION, readHomileticList } from './homileticPlan';
import { carryHomileticOrder, rebaseHomileticOrder } from './homileticPlanMoves';
import { mergeFields } from './protocol';
import { placementSteps, retainedStepOrderChanged } from './serviceOrderStepPlacement';

import type { HomileticList } from './homileticPlan';
import type { ConflictDetail, DocumentData } from './types';

type Rows = NonNullable<ReturnType<typeof readHomileticList>>;
const asField = (value: Rows) => ({ exists: true, value });
const sameFrame = (left: Rows, right: Rows) => equalValues(left.map(row => row.id), right.map(row => row.id));

export function reviewedHomileticList(conflicts: readonly ConflictDetail[], selection: readonly (readonly unknown[])[]): HomileticList | undefined {
  for (const conflict of conflicts) {
    const list = homileticComparisonList(conflict);
    if (list && selection.some(path => equalValues(path, homileticListPath(list)))) return list;
  }
}

function commonIds(first: Rows, second: Rows) {
  const available = new Set(second.map(row => row.id));
  return new Set(first.filter(row => available.has(row.id)).map(row => row.id));
}

function remoteTitleChoice(mine: Rows, before: Rows, stored: Rows, rowId: string): Rows {
  const opening = before.find(row => row.id === rowId), live = stored.find(row => row.id === rowId);
  if (!opening || !live) return mine.filter(row => row.id !== rowId);
  return mine.map(row => row.id === rowId ? { ...row, title: opening.title } : row);
}

function projectTitleDecisions(before: Rows, mine: Rows, live: Rows, prior: Rows, path: string[], conflicts: readonly ConflictDetail[],
  choice: 'local' | 'remote') {
  for (const item of conflicts) {
    if (!equalValues(item.path.slice(0, 3), path) || !item.path[3]?.startsWith('id:')) continue;
    const rowId = item.path[3].slice(3);
    const stored = live.find(row => row.id === rowId);
    if (item.code !== HOMILETIC_TITLE_PROJECTION || typeof item.mine.value !== 'string') {
      if (choice === 'local' && !stored) return;
      if (choice === 'remote') mine = remoteTitleChoice(mine, before, live, rowId);
      continue;
    }
    const shown = prior.find(row => row.id === rowId);
    if (!stored || stored.title !== shown?.title) {
      mine = remoteTitleChoice(mine, before, live, rowId);
      continue;
    }
    before = before.map(row => row.id === rowId ? { ...row, title: stored.title } : row);
    const winner = item.mine.value;
    mine = mine.map(row => row.id === rowId && equalValues(row.title, item.base.value) ? { ...row, title: winner } : row);
  }
  return { before, mine };
}

/** Use the server's proposed position, but merge every independent authored row and title. */
export function projectHomileticReview(basis: DocumentData | null, proposed: DocumentData | null, stored: DocumentData,
  compared: DocumentData | null, list: HomileticList, conflicts: readonly ConflictDetail[], choice: 'local' | 'remote',
  submitted?: DocumentData | null): DocumentData | undefined {
  let before = readHomileticList(basis?.preparation, list);
  let mine = readHomileticList(proposed?.preparation, list);
  const live = readHomileticList(stored.preparation, list);
  const prior = readHomileticList(compared?.preparation, list);
  if (!before || !mine || !live || !prior) return;
  const path = homileticListPath(list);
  const staged = mine;
  const sent = choice === 'local' ? readHomileticList(submitted?.preparation, list) : undefined;
  const position = conflicts.find(item => (item.code === HOMILETIC_POSITION_REVIEW || item.code === HOMILETIC_POSITION_PROJECTION) && equalValues(item.path, path));
  const retained = new Set([...commonIds(before, mine)].filter(id => live.some(row => row.id === id)));
  if (position) {
    // Keep the captured order comparison separate from the three-way merge of row content.
    before = carryHomileticOrder(before, live, retained);
    mine = carryHomileticOrder(mine, live, retained);
  }
  const projected = projectTitleDecisions(before, mine, live, prior, path, conflicts, choice);
  if (!projected) return;
  const merged = mergeFields(asField(projected.before), asField(projected.mine), asField(live), path);
  let rows = placementSteps(merged.value.value);
  if (!rows) return;
  // A local title edit must never bring back a row removed while its comparison was open.
  if (rows.some(row => projected.before.some(original => original.id === row.id) && !live.some(current => current.id === row.id))) return;
  if (choice === 'remote' && merged.conflicts.length) return;
  if (position) {
    const chosen = placementSteps((choice === 'local' ? position.mine : position.theirs).value);
    if (!chosen) return;
    const frameChanged = !sameFrame(prior, live);
    const shouldApply = retainedStepOrderChanged(prior, chosen);
    if (shouldApply) {
      const ordered = frameChanged ? rebaseHomileticOrder(rows, prior, chosen)
        : carryHomileticOrder(rows, chosen, commonIds(rows, chosen));
      if (!ordered) return;
      rows = ordered;
    }
    if (sent && !sameFrame(sent, staged)) {
      const amended = !frameChanged && sameFrame(chosen, sent)
        ? carryHomileticOrder(rows, staged, commonIds(rows, staged))
        : rebaseHomileticOrder(rows, sent, staged);
      if (!amended) return;
      rows = amended;
    }
  }
  return writeField(stored, path, asField(rows));
}
