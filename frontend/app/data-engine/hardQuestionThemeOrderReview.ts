import { equalValues, object, readField } from './fieldValues';
import { HARD_QUESTION_FIELD_REVIEW, hardQuestionReviewFrames, hardQuestionTextField } from './hardQuestionFieldAction';
import { hardQuestionThemeListPath, keepsBasisScripture } from './hardQuestionThemeLists';
import { projectManualSelection, type ManualPath } from './manualScope';
import { mergeDocumentFields, projectHardQuestionThemeOrders } from './protocol';

import type { HardQuestionTextField } from './hardQuestionFieldAction';
import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData } from './types';

type VersionSide = 'local' | 'remote';

const collection = 'hardQuestionThemes';
const themeTextField = (path: readonly string[]) => hardQuestionTextField(collection, path);

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

function hasHeldListChange(checkpoint: SessionCheckpoint): boolean {
  if (!checkpoint.conflicts.some(({ code, path }) => code === HARD_QUESTION_FIELD_REVIEW && themeTextField(path))) return false;
  const [submission] = Object.values(checkpoint.pending).sort((a, b) => a.generation - b.generation);
  const value = submission?.value;
  return Boolean(value && !submission.borrowedManualScope
    && ['groups', 'bases'].some(list => !equalValues(value[list], checkpoint.confirmed.value?.[list])));
}

function themeReview(checkpoint: SessionCheckpoint) {
  const { confirmed, draft, remoteCandidate: stored } = checkpoint;
  if (confirmed.resource.collection !== collection || !confirmed.value || !draft || !stored?.value
    || !confirmed.metadata || stored.metadata?.generation !== confirmed.metadata.generation) return;

  const listed = checkpoint.conflicts.some(({ path }) => hardQuestionThemeListPath(path));
  // A fresh text conflict can refuse an entire compound replacement. Its chosen order is still
  // waiting in that document request even if there is no new disagreement about it.
  const heldList = !listed && hasHeldListChange(checkpoint);
  if (!listed && !heldList) return;

  const framed = hardQuestionReviewFrames(confirmed, draft, stored, checkpoint.conflicts);
  const mine = framed.reviewed!;
  const saved = stored.value;
  const { conflicts } = mergeDocumentFields(framed.basis.value, mine, saved);
  if (conflicts.some(({ path }) => !hardQuestionThemeListPath(path) && !rowSelection(path) && !themeTextField(path))) return;
  const mixedOrder = conflicts.some(({ path }) => hardQuestionThemeListPath(path))
    && [...conflicts, ...checkpoint.conflicts].some(({ path }) => themeTextField(path));
  if (!mixedOrder && !heldList && !conflicts.some(({ path }) => rowSelection(path))) return;

  // The processor can prove changed intent even when the words returned to their starting value.
  for (const { path, code } of framed.conflicts) {
    if (!themeTextField(path) || conflicts.some(field => equalValues(field.path, path))) continue;
    const local = readField(mine, path), theirs = readField(saved, path);
    if (!equalValues(local, theirs)) conflicts.push({ path, code, base: readField(framed.basis.value!, path), mine: local, theirs });
  }

  if (!conflicts.length) return;
  return { basis: framed.basis, mine, stored,
    identity: JSON.stringify([confirmed, checkpoint.editGeneration, stored, conflicts]),
    fields: conflicts.map(conflict => reviewedField(conflict, mine, saved)) };
}

export function readHardQuestionThemeOrderReview(checkpoint: SessionCheckpoint) {
  const review = themeReview(checkpoint);
  return review && { identity: review.identity, fields: review.fields };
}

export function resolveHardQuestionThemeOrderReview(checkpoint: SessionCheckpoint, identity: string,
  choices: HardQuestionThemeOrderChoices): { value: DocumentData; reviewedText: HardQuestionTextField[] } {
  const review = themeReview(checkpoint);
  const changed = () => Object.assign(new Error('The shown theme comparison changed'), { code: 'decision-changed' });
  if (!review || review.identity !== identity || review.fields.length !== Object.keys(choices).length
    || review.fields.some(({ id }) => !Object.hasOwn(choices, id) || (choices[id] !== 'local' && choices[id] !== 'remote'))) throw changed();

  const { basis, stored } = review;
  const original = stored.value!;
  let mine = review.mine, saved = original;
  const reviewedText: HardQuestionTextField[] = [];
  for (const field of review.fields) {
    const text = themeTextField(field.path);
    const selection = text ? field.path : rowSelection(field.path);
    if (!selection) continue;
    if (choices[field.id] === 'local') {
      saved = projectManualSelection(saved, review.mine, [selection]);
      if (text) reviewedText.push(text);
    } else mine = projectManualSelection(mine, original, [selection]);
  }
  const merged = mergeDocumentFields(basis.value, mine, saved);
  if (!object(merged.value.value) || merged.conflicts.some(({ path }) => !hardQuestionThemeListPath(path))) throw changed();
  let value: DocumentData = merged.value.value;
  for (const field of review.fields) {
    if (!hardQuestionThemeListPath(field.path)) continue;
    const projected = projectHardQuestionThemeOrders(basis, mine, { ...stored, value: saved }, [field], choices[field.id], value);
    if (!projected) throw changed();
    value = projected;
  }
  if (!keepsBasisScripture(original.bases, value.bases)) throw changed();
  return { value, reviewedText };
}
