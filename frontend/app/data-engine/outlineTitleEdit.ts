import { findPointSection, findSubPointParent } from '@/utils/outlineDnd';
import { outlineTitleConflictTarget, outlineTitleField, withOutlineTitleText, type OutlineTitleOpening } from '@/utils/sermonNoteText';

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

export function readOutlineTitleComparison({ confirmed, draft, remoteCandidate, conflicts, editGeneration }: SessionCheckpoint) {
  if (conflicts.length !== 1 || !draft || !remoteCandidate?.value || !sameGeneration(confirmed, remoteCandidate)) return undefined;
  const { path, mine: conflictMine } = conflicts[0];
  const field = confirmed.resource.collection === 'planTemplates' ? 'structure' : 'outline';
  if (path[0] !== field) return undefined;
  const target = outlineTitleConflictTarget(path);
  if (!target) return undefined;
  const local = outlineTitleField(outlineOf(draft, field), target, field);
  const saved = outlineTitleField(outlineOf(remoteCandidate.value, field), target, field);
  if (!local || conflictMine.value !== local.text || saved?.text === local.text) return undefined;
  return { mine: local.text, stored: saved?.text,
    identity: JSON.stringify([path, local.text, saved?.text, remoteCandidate.metadata, editGeneration]) };
}

/** Retire only a compared title when taking the stored version. */
export function keepUncontestedOutlineTitle(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[]): DocumentData | undefined {
  if (conflicts.length !== 1 || !draft || !stored?.value || !sameGeneration(basis, stored)) return undefined;
  const field = basis.resource.collection === 'planTemplates' ? 'structure' : 'outline';
  const { path } = conflicts[0];
  if (path[0] !== field) return undefined;
  const target = outlineTitleConflictTarget(path);
  const local = outlineOf(draft, field);
  if (!target || !local) return undefined;
  const before = outlineTitleField(outlineOf(basis.value, field), target, field);
  if (!before) return undefined;
  const reverted = withOutlineTitleText(local, target, before.text);
  if (!reverted) return undefined;
  const merged = mergeDocumentFields(basis.value, { ...draft, [field]: reverted as unknown as Json }, stored.value);
  if (merged.conflicts.length) {
    throw Object.assign(new Error('Other changes need review'), { code: 'other-changes-first' });
  }
  return merged.value.exists ? merged.value.value as DocumentData : undefined;
}
