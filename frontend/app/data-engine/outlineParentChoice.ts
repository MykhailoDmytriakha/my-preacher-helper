import { findPointSection, findSubPointParent, moveSubPoint, outlinePointGap, SECTION_KEYS } from '@/utils/outlineDnd';
import { outlineTitleConflictTarget, outlineTitleField, withOutlineTitleText } from '@/utils/sermonNoteText';

import { equalValues, readField, writeField } from './fieldValues';
import { outlinePlacementField, replaceResourceOutline } from './outlinePlacementResource';
import { OUTLINE_TITLE_QUEUED, OUTLINE_TITLE_REVIEW, OUTLINE_TITLE_SETTLED } from './outlineTitleAction';
import { outlineTitleChoiceFrames } from './outlineTitleEdit';
import { mergeDocumentFields } from './protocol';
import { templateOutline } from './templateOutlineMerge';

import type { SessionCheckpoint } from './session';
import type { ConflictDetail, DocumentData, ResourceSnapshot } from './types';
import type { SermonOutline } from '@/models/models';

const readOutline = (value: unknown) => templateOutline(value) as unknown as SermonOutline | undefined;

function readParentChoice(collection: string, conflicts: readonly ConflictDetail[]) {
  const field = outlinePlacementField(collection);
  const root = field && conflicts.find(({ path }) => path.length === 1 && path[0] === field);
  if (!field || !root) return undefined;
  const opening = readOutline(root.base.value), mine = readOutline(root.mine.value), stored = readOutline(root.theirs.value);
  if (!opening || !mine || !stored) return undefined;
  const children = SECTION_KEYS.flatMap(section => opening[section].flatMap(point => (point.subPoints ?? []).filter(child => {
    const local = findSubPointParent(mine, child.id), remote = findSubPointParent(stored, child.id);
    return local && remote && local.point.id !== remote.point.id && local.point.id !== point.id && remote.point.id !== point.id;
  })));
  return children.length ? { field, root, opening, children } : undefined;
}

function currentFrames(choice: NonNullable<ReturnType<typeof readParentChoice>>, draft: DocumentData | null, latest: DocumentData | null) {
  const mine = readOutline(draft?.[choice.field]);
  const stored = readOutline(latest?.[choice.field]);
  if (!mine || !stored) return undefined;
  const moves = choice.children.flatMap(child => {
    const local = findSubPointParent(mine, child.id), remote = findSubPointParent(stored, child.id);
    return local && remote ? [{ child, local, remote }] : [];
  });
  return moves.length === choice.children.length ? { mine, stored, moves } : undefined;
}

export function hasOutlineParentChoice(collection: string, conflicts: readonly ConflictDetail[]): boolean {
  return Boolean(readParentChoice(collection, conflicts));
}

export interface OutlineTitleVersion {
  id: string;
  mine: string;
  stored: string;
}

export interface OutlineTitleDecision extends OutlineTitleVersion {
  side: 'local' | 'remote';
}

type ParentCheckpoint = Pick<SessionCheckpoint, 'confirmed' | 'conflicts' | 'draft' | 'remoteCandidate'>;

export function readOutlineParentComparison({ confirmed, conflicts, draft, remoteCandidate }: ParentCheckpoint) {
  const choice = readParentChoice(confirmed.resource.collection, conflicts);
  const current = choice && currentFrames(choice, draft, remoteCandidate?.value ?? null);
  if (!choice || !current) return undefined;
  let frames: ReturnType<typeof parentChoiceMerge>;
  try { frames = parentChoiceMerge(confirmed, draft, remoteCandidate, conflicts, choice, 'remote'); }
  catch { return { ...choice, ...current, titles: [] }; }
  const titles = frames ? comparedTitles(frames, conflicts, choice.field) : [];
  return { ...choice, ...current, opening: readOutline(confirmed.value?.[choice.field]) ?? choice.opening, titles: titles.map(({ version }) => version) };
}

type SubpointHome = NonNullable<ReturnType<typeof findSubPointParent>>;

/** Align a newly added parent without treating its other children as opening data. */
function withNewParent(outline: SermonOutline, selected: SermonOutline, target: SubpointHome): SermonOutline {
  const gap = outlinePointGap(selected, target.point.id)!;
  const points = outline[gap.section];
  const before = points.findIndex(point => point.id === gap.previous);
  const after = points.findIndex(point => point.id === gap.next);
  const index = before >= 0 ? before + 1 : after >= 0 ? after : points.length;
  return { ...outline, [gap.section]: [...points.slice(0, index), { ...target.point, subPoints: [] }, ...points.slice(index)] };
}

function targetSubpointIndex(current: readonly { id: string }[], target: SubpointHome): number {
  const siblings = target.point.subPoints ?? [];
  const previous = siblings.slice(0, target.index).reverse().find(item => current.some(row => row.id === item.id));
  if (previous) return current.findIndex(item => item.id === previous.id) + 1;
  const following = siblings.slice(target.index + 1).find(item => current.some(row => row.id === item.id));
  return following ? current.findIndex(item => item.id === following.id) : target.index;
}

const changed = () => Object.assign(new Error('The subpoint comparison changed or other changes need review'), { code: 'decision-changed' });

/** Ordering can change only these proven title leaves in the server's placement ancestor. */
function matchesOpeningTitleFrame(opening: SermonOutline, choice: NonNullable<ReturnType<typeof readParentChoice>>,
  conflicts: readonly ConflictDetail[]): boolean {
  if (equalValues(opening, choice.root.base.value)) return true;
  let ordered = opening;
  for (const { code, path, base, mine, theirs } of conflicts) {
    if ((code !== OUTLINE_TITLE_SETTLED && code !== OUTLINE_TITLE_QUEUED) || path[0] !== choice.field) continue;
    const target = outlineTitleConflictTarget(path);
    // The write can still carry the older title action after rebasing its placement.
    // The receipt identifies exactly the leaf it ordered and the stored value used.
    if (!target || !outlineTitleField(opening, target, choice.field) || typeof base.value !== 'string'
      || typeof theirs.value !== 'string' || typeof mine.value !== 'string') continue;
    ordered = withOutlineTitleText(ordered, target, theirs.value) ?? ordered;
  }
  return equalValues(ordered, choice.root.base.value);
}

function parentChoiceMerge(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[], choice: NonNullable<ReturnType<typeof readParentChoice>>, side: 'local' | 'remote') {
  const { field } = choice;
  if (!basis.value || !draft || !stored?.value || !basis.metadata || basis.metadata.generation !== stored.metadata?.generation) return undefined;
  const openingOutline = readOutline(basis.value[field]);
  if (!openingOutline || !matchesOpeningTitleFrame(openingOutline, choice, conflicts)) return undefined;
  const aligned = outlineTitleChoiceFrames(basis, draft, stored, conflicts);
  const opening = readOutline(aligned.basis?.[field]);
  if (!opening || !aligned.basis || !aligned.draft) return undefined;
  const current = currentFrames(choice, aligned.draft, stored.value);
  if (!current) return undefined;
  const { moves } = current;
  const project = (value: DocumentData, outline: SermonOutline): DocumentData => {
    let next = outline;
    for (const { child, [side]: target } of moves) {
      const parentId = target.point.id;
      if (!findPointSection(next, parentId)) {
        if (findPointSection(choice.opening, parentId) || findSubPointParent(next, parentId)) throw changed();
        next = withNewParent(next, side === 'local' ? current.mine : current.stored, target);
      }
      const section = findPointSection(next, parentId)!;
      const children = next[section].find(point => point.id === parentId)?.subPoints ?? [];
      const currentIndex = children.findIndex(item => item.id === child.id);
      const targetIndex = targetSubpointIndex(children.filter(item => item.id !== child.id), target);
      if (currentIndex !== targetIndex) {
        next = moveSubPoint(next, child.id, parentId, currentIndex >= 0 && currentIndex < targetIndex ? targetIndex + 1 : targetIndex);
      }
    }
    return replaceResourceOutline(basis.resource.collection, value, next);
  };
  const ancestor = project(aligned.basis, opening);
  const mine = side === 'local' ? aligned.draft : project(aligned.draft, current.mine);
  const theirs = side === 'remote' ? stored.value : project(stored.value, current.stored);
  const authored = writeField(mine, ['updatedAt'], readField(stored.value, ['updatedAt']));
  return { merged: mergeDocumentFields(ancestor, authored, theirs), current };
}

function outlineTitleComparisons(conflicts: readonly ConflictDetail[], field: 'outline' | 'structure') {
  return conflicts.flatMap(({ path, mine, theirs }) => {
    const target = path[0] === field && outlineTitleConflictTarget(path);
    return target && typeof mine.value === 'string' && typeof theirs.value === 'string'
      ? [{ target, version: { id: target.id, mine: mine.value, stored: theirs.value } }] : [];
  });
}

function comparedTitles(frames: NonNullable<ReturnType<typeof parentChoiceMerge>>, conflicts: readonly ConflictDetail[], field: 'outline' | 'structure') {
  const fromMerge = outlineTitleComparisons(frames.merged.conflicts, field);
  // An unresolved receipt can require a choice even when the saved title returned to its opening words.
  const unresolved = outlineTitleComparisons(conflicts.filter(({ code }) => code === OUTLINE_TITLE_REVIEW), field);
  const titles = new Map(fromMerge.map(entry => [entry.version.id, entry]));
  for (const entry of unresolved) {
    const { target, version } = entry;
    if (!titles.has(version.id) && version.mine !== version.stored
      && outlineTitleField(frames.current.mine, target, field)?.text === version.mine
      && outlineTitleField(frames.current.stored, target, field)?.text === version.stored) titles.set(version.id, entry);
  }
  return [...titles.values()];
}

/** Choose the affected child homes and the independently reviewed title leaves. */
export function projectOutlineParentChoice(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[], side: 'local' | 'remote', decisions: readonly OutlineTitleDecision[] = []): DocumentData | undefined {
  const choice = readParentChoice(basis.resource.collection, conflicts);
  if (!choice) {
    if (decisions.length) throw changed();
    return undefined;
  }
  const frames = parentChoiceMerge(basis, draft, stored, conflicts, choice, side);
  if (!frames?.merged.value.exists) throw changed();
  const { merged } = frames;
  const value = merged.value.value as DocumentData;
  const titles = comparedTitles(frames, conflicts, choice.field);
  if (outlineTitleComparisons(merged.conflicts, choice.field).length !== merged.conflicts.length || titles.length !== decisions.length) throw changed();
  if (!titles.length) return value;
  let outline = readOutline(value[choice.field]);
  if (!outline) throw changed();
  for (const { target, version } of titles) {
    const selected = decisions.filter(({ id, mine, stored }) => id === version.id && mine === version.mine && stored === version.stored);
    if (selected.length !== 1) throw changed();
    outline = withOutlineTitleText(outline, target, selected[0].side === 'local' ? version.mine : version.stored);
    if (!outline) throw changed();
  }
  return { ...value, [choice.field]: outline as unknown as DocumentData };
}
