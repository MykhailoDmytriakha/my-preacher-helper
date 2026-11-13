import { findPointSection, findSubPointParent, moveSubPoint, outlinePointGap, SECTION_KEYS } from '@/utils/outlineDnd';

import { equalValues, readField, writeField } from './fieldValues';
import { outlinePlacementField, replaceResourceOutline } from './outlinePlacementResource';
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

export function readOutlineParentComparison(checkpoint: Pick<SessionCheckpoint, 'confirmed' | 'conflicts' | 'draft' | 'remoteCandidate'>) {
  const choice = readParentChoice(checkpoint.confirmed.resource.collection, checkpoint.conflicts);
  const current = choice && currentFrames(choice, checkpoint.draft, checkpoint.remoteCandidate?.value ?? null);
  return choice && current && { ...choice, ...current };
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

/** Put the reviewed child in the selected home on both merge frames so only its move is chosen. */
export function projectOutlineParentChoice(basis: ResourceSnapshot, draft: DocumentData | null, stored: ResourceSnapshot | null,
  conflicts: readonly ConflictDetail[], side: 'local' | 'remote'): DocumentData | undefined {
  const choice = readParentChoice(basis.resource.collection, conflicts);
  if (!choice) return undefined;
  const changed = () => Object.assign(new Error('The subpoint comparison changed or other changes need review'), { code: 'decision-changed' });
  const { field, root } = choice;
  if (!basis.value || !draft || !stored?.value || !basis.metadata || basis.metadata.generation !== stored.metadata?.generation
    || !equalValues(readField(basis.value, [field]), root.base)) throw changed();
  const current = currentFrames(choice, draft, stored.value);
  if (!current) throw changed();
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
  const opening = project(basis.value, choice.opening);
  const mine = side === 'local' ? draft : project(draft, current.mine);
  const theirs = side === 'remote' ? stored.value : project(stored.value, current.stored);
  const merged = mergeDocumentFields(opening, writeField(mine, ['updatedAt'], readField(stored.value, ['updatedAt'])), theirs);
  if (!merged.value.exists || merged.conflicts.length) throw changed();
  return merged.value.value as DocumentData;
}
