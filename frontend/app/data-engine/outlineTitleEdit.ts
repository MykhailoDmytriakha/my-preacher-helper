import { findPointSection, findSubPointParent } from '@/utils/outlineDnd';
import { outlineTitleConflictTarget, outlineTitleField, withOutlineTitleText, type OutlineTitleOpening } from '@/utils/sermonNoteText';

import { OUTLINE_TITLE_QUEUED, OUTLINE_TITLE_SETTLED } from './outlineTitleAction';
import { mergeDocumentFields } from './protocol';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, Json, ResourceSnapshot } from './types';
import type { SermonOutline } from '@/models/models';

const outlineOf = (value: DocumentData | null | undefined, field: 'structure' | 'outline') =>
  (value?.[field] ?? null) as unknown as SermonOutline | null;

const titleValue = (value: string) => ({ exists: true, value });

const changedTitle = () => Object.assign(new Error('The opened point is no longer available'), { code: 'decision-changed' });

const sameResource = (a: ResourceSnapshot, b: ResourceSnapshot) =>
  a.resource.collection === b.resource.collection && a.resource.id === b.resource.id;

function sameGeneration(a: ResourceSnapshot, b: ResourceSnapshot): boolean {
  return sameResource(a, b) && Boolean(a.value && b.value) && !a.metadata?.deleted && !b.metadata?.deleted
    && (a.metadata && b.metadata ? a.metadata.generation === b.metadata.generation
      : a.value!.createdAt !== undefined && a.value!.createdAt === b.value!.createdAt);
}

/** A visible pending create remains the same opening when that exact operation is acknowledged. */
function continuesTemplateCreation(shown: SessionCheckpoint, current: SessionCheckpoint, stored: ResourceSnapshot): boolean {
  const opening = shown.confirmed;
  const birth = shown.draft?.createdAt, owner = shown.draft?.userId;
  if (opening.value !== null || opening.metadata !== null || !sameResource(opening, stored) || stored.metadata?.deleted
    || typeof birth !== 'string' || typeof owner !== 'string'
    || current.draft?.createdAt !== birth || current.draft?.userId !== owner) return false;
  const matches = (value: DocumentData | null | undefined) => value?.createdAt === birth && value.userId === owner;
  const pending = Object.entries(shown.pending).filter(([, intent]) => matches(intent.value));
  const generation = stored.metadata?.generation;
  if (generation) {
    return matches(stored.value) && pending.some(([id, intent]) => id === generation || intent.operations?.includes(generation));
  }
  return stored.value === null && pending.some(([id]) => matches(current.pending[id]?.value));
}

/** Prepare one explicit title over the live template, retaining a competing stored title. */
export function templateTitleEdit(state: SessionCheckpoint, shown: SessionCheckpoint, opening: OutlineTitleOpening, title: string) {
  const stored = state.remoteCandidate ?? state.confirmed;
  const draft = state.draft;
  const live = outlineOf(draft, 'structure');
  const savedOutline = outlineOf(stored.value, 'structure');
  const openingOutline = outlineOf(shown.confirmed.value, 'structure');
  const creating = continuesTemplateCreation(shown, state, stored);
  if (stored.resource.collection !== 'planTemplates' || (!sameGeneration(shown.confirmed, stored) && !creating) || !draft || !live
    || outlineTitleField(outlineOf(shown.draft, 'structure'), opening.target, 'structure')?.text !== opening.text) throw changedTitle();
  const projected = withOutlineTitleText(live, opening.target, title);
  if (!projected || (!creating && (!savedOutline || !openingOutline))) throw changedTitle();
  const updated = { ...draft, structure: projected as unknown as Json };
  const forTitle = ({ path }: ConflictDetail) => outlineTitleConflictTarget(path)?.id === opening.target.id;
  const existing = state.conflicts.find(forTitle);
  const saved = outlineTitleField(savedOutline, opening.target, 'structure');
  if (!saved) {
    const hasRow = (outline: SermonOutline) => findPointSection(outline, opening.target.id) || findSubPointParent(outline, opening.target.id);
    const confirmed = outlineOf(state.confirmed.value, 'structure');
    // An earlier local insertion already belongs to the live draft, even before its first ACK.
    if (existing || (savedOutline && hasRow(savedOutline)) || (openingOutline && hasRow(openingOutline))
      || (confirmed && hasRow(confirmed))) throw changedTitle();
    return { draft: updated, stored, conflicts: state.conflicts, conflictingTitle: false };
  }
  const earlier = outlineTitleField(openingOutline, opening.target, 'structure')?.text;
  const conflict = saved.text !== title && (existing || (saved.text !== opening.text && saved.text !== earlier))
    ? { path: saved.path, base: existing?.base ?? titleValue(opening.text), mine: titleValue(title), theirs: titleValue(saved.text) }
    : undefined;
  const conflicts = state.conflicts.filter(item => !forTitle(item));
  if (conflict) conflicts.push(conflict);
  return { draft: updated, stored, conflicts, conflictingTitle: Boolean(conflict) };
}

export const unresolvedOutlineTitleConflicts = (conflicts: readonly ConflictDetail[]) =>
  conflicts.filter(({ code }) => code !== OUTLINE_TITLE_SETTLED && code !== OUTLINE_TITLE_QUEUED);

/** Keep resolved leaves out of the comparison. A queued winner still carries its original action. */
export function outlineTitleChoiceFrames(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot,
  conflicts: readonly ConflictDetail[]) {
  const frames = { basis: basis.value, draft, removed: [] as string[][] };
  if (!draft || !sameGeneration(basis, stored)) return frames;
  const field = basis.resource.collection === 'planTemplates' ? 'structure' : 'outline';
  const initialLocal = outlineOf(draft, field), initialOpening = outlineOf(basis.value, field);
  const live = outlineOf(stored.value, field);
  if (!initialLocal || !live || !initialOpening) return frames;
  let local = initialLocal;
  let opening = initialOpening;
  for (const { path, code, mine } of conflicts) {
    if ((code !== OUTLINE_TITLE_SETTLED && code !== OUTLINE_TITLE_QUEUED) || path[0] !== field) continue;
    const target = outlineTitleConflictTarget(path);
    if (!target) continue;
    const saved = outlineTitleField(live, target, field)?.text;
    const original = outlineTitleField(opening, target, field);
    if (saved === undefined && original) frames.removed.push(original.path.slice(0, -1));
    if (outlineTitleField(local, target, field)?.text !== mine.value) continue;
    if (code === OUTLINE_TITLE_QUEUED && saved !== undefined) {
      const aligned = withOutlineTitleText(opening, target, saved);
      if (aligned && aligned !== opening) {
        opening = aligned;
        frames.basis = { ...frames.basis, [field]: opening as unknown as Json };
      }
    } else {
      // An action already superseded by a saved title stays retired when that title changes again.
      const title = saved ?? original?.text;
      const retired = title === undefined ? undefined : withOutlineTitleText(local, target, title);
      if (retired && retired !== local) {
        local = retired;
        frames.draft = { ...frames.draft, [field]: local as unknown as Json };
      }
    }
  }
  return frames;
}

export function readOutlineTitleComparison({ confirmed, draft, remoteCandidate, conflicts: allConflicts, editGeneration }: SessionCheckpoint) {
  const conflicts = unresolvedOutlineTitleConflicts(allConflicts);
  if (!conflicts.length || !draft || !remoteCandidate?.value || !sameGeneration(confirmed, remoteCandidate)) return undefined;
  const field = confirmed.resource.collection === 'planTemplates' ? 'structure' : 'outline';
  const proposed = outlineOf(draft, field), storedOutline = outlineOf(remoteCandidate.value, field);
  const compared: { path: string[]; mine: string; stored: string | undefined }[] = [];
  for (const { path, mine } of conflicts) {
    const target = path[0] === field && outlineTitleConflictTarget(path);
    if (!target) return undefined;
    const local = outlineTitleField(proposed, target, field);
    const saved = outlineTitleField(storedOutline, target, field);
    if (!local || mine.value !== local.text || saved?.text === local.text) return undefined;
    compared.push({ path, mine: local.text, stored: saved?.text });
  }
  const removed = compared.some(entry => entry.stored === undefined);
  const numbered = (side: 'mine' | 'stored') => compared.map((entry, index) => (index + 1) + '. ' + (entry[side] ?? '—')).join('\n');
  return { mine: compared.length === 1 ? compared[0].mine : numbered('mine'),
    stored: compared.length === 1 ? compared[0].stored : numbered('stored'), removed,
    identity: JSON.stringify([compared, remoteCandidate.metadata, editGeneration]) };
}

/** Retire only a compared title when taking the stored version. */
export function keepUncontestedOutlineTitle(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  allConflicts: readonly ConflictDetail[]): DocumentData | undefined {
  const conflicts = unresolvedOutlineTitleConflicts(allConflicts);
  if (!conflicts.length || !draft || !stored?.value || !sameGeneration(basis, stored)) return undefined;
  const decided = outlineTitleChoiceFrames(basis, draft, stored, allConflicts);
  const field = basis.resource.collection === 'planTemplates' ? 'structure' : 'outline';
  const opening = outlineOf(basis.value, field);
  let local = outlineOf(decided.draft, field);
  if (!local || !opening) return undefined;
  for (const { path } of conflicts) {
    const target = path[0] === field && outlineTitleConflictTarget(path);
    const before = target && outlineTitleField(opening, target, field);
    if (!target || !before) return undefined;
    const reverted = withOutlineTitleText(local, target, before.text);
    if (!reverted) return undefined;
    local = reverted;
  }
  const merged = mergeDocumentFields(decided.basis, { ...decided.draft, [field]: local as unknown as Json }, stored.value);
  if (merged.conflicts.length) {
    throw Object.assign(new Error('Other changes need review'), { code: 'other-changes-first' });
  }
  return merged.value.exists ? merged.value.value as DocumentData : undefined;
}
