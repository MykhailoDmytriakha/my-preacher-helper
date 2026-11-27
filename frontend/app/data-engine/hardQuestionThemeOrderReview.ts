import { object } from './fieldValues';
import { hardQuestionThemeListPath, keepsBasisScripture } from './hardQuestionThemeLists';
import { projectManualSelection, type ManualPath } from './manualScope';
import { mergeDocumentFields, projectHardQuestionThemeOrders } from './protocol';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData } from './types';

type VersionSide = 'local' | 'remote';

export type HardQuestionThemeOrderChoices = Readonly<Record<string, VersionSide>>;

function rowSelection(path: readonly string[]): ManualPath | undefined {
  if ((path.length !== 2 && path.length !== 3) || !hardQuestionThemeListPath(path.slice(0, 1))
    || !path[1].startsWith('id:') || path[1].length === 3) return;
  return [path[0], { id: path[1].slice(3) }, ...path.slice(2)];
}

function atRow(document: DocumentData, path: readonly string[]): DocumentData | undefined {
  const rows = document[path[0]];
  const id = path[1]?.slice(3);
  const row = Array.isArray(rows) && rows.find(item => object(item) && item.id === id);
  return object(row) ? row : undefined;
}

function reviewedField(field: ConflictDetail, local: DocumentData, stored: DocumentData) {
  const path = field.path;
  const title = atRow(local, path)?.title ?? atRow(stored, path)?.title;
  return { ...field, id: JSON.stringify(path), ...(typeof title === 'string' && { rowTitle: title }) };
}

export function readHardQuestionThemeOrderReview(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate: stored } = checkpoint;
  if (confirmed.resource.collection !== 'hardQuestionThemes' || !confirmed.value || !draft || !stored?.value
    || !confirmed.metadata || stored.metadata?.generation !== confirmed.metadata.generation
    || !checkpoint.conflicts.some(({ path }) => hardQuestionThemeListPath(path))) return;
  const { conflicts } = mergeDocumentFields(confirmed.value, draft, stored.value);
  if (!conflicts.some(({ path }) => rowSelection(path))
    || conflicts.some(({ path }) => !hardQuestionThemeListPath(path) && !rowSelection(path))) return;
  return { identity: JSON.stringify([confirmed, checkpoint.editGeneration, stored, conflicts]),
    fields: conflicts.map(conflict => reviewedField(conflict, draft, stored.value!)) };
}

export function resolveHardQuestionThemeOrderReview(checkpoint: SessionCheckpoint, identity: string,
  choices: HardQuestionThemeOrderChoices): DocumentData {
  const review = readHardQuestionThemeOrderReview(checkpoint);
  const { confirmed, draft, remoteCandidate: stored } = checkpoint;
  const changed = () => Object.assign(new Error('The shown theme comparison changed'), { code: 'decision-changed' });
  if (!review || review.identity !== identity || !draft || !stored?.value
    || review.fields.length !== Object.keys(choices).length
    || review.fields.some(({ id }) => !Object.hasOwn(choices, id) || (choices[id] !== 'local' && choices[id] !== 'remote'))) throw changed();

  let mine = draft, saved = stored.value;
  for (const field of review.fields) {
    const selection = rowSelection(field.path);
    if (!selection) continue;
    if (choices[field.id] === 'local') saved = projectManualSelection(saved, draft, [selection]);
    else mine = projectManualSelection(mine, stored.value, [selection]);
  }
  const merged = mergeDocumentFields(confirmed.value, mine, saved);
  if (!object(merged.value.value) || merged.conflicts.some(({ path }) => !hardQuestionThemeListPath(path))) throw changed();
  let value: DocumentData = merged.value.value;
  for (const field of review.fields) {
    if (!hardQuestionThemeListPath(field.path)) continue;
    const projected = projectHardQuestionThemeOrders(confirmed, mine, { ...stored, value: saved }, [field], choices[field.id], value);
    if (!projected) throw changed();
    value = projected;
  }
  if (!keepsBasisScripture(stored.value.bases, value.bases)) throw changed();
  return value;
}
