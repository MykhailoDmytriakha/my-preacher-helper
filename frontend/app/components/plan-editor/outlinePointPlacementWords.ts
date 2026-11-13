import { readOutlineParentComparison, readOutlinePointPlacementComparison } from '@/data-engine/react.client';
import { findPointSection, outlinePointText } from '@/utils/outlineDnd';
import { getSectionLabel } from '@lib/sections';

import type { ApplyOutlineReview, TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { SermonOutline } from '@/models/models';
import type { OutlinePointGap, OutlineSubpointGap } from '@/utils/outlineDnd';

type Translate = (key: string, values?: Record<string, string>) => string;

export function outlinePointPlacementWords(gap: OutlinePointGap | undefined, outline: SermonOutline, t: Translate): string {
  if (!gap) return t('planEditor.pointPlacement.unavailable');
  const section = getSectionLabel(t, gap.section);
  const next = gap.next && outlinePointText(outline, gap.next);
  if (next) return t('planEditor.pointPlacement.before', { section, point: next });
  const previous = gap.previous && outlinePointText(outline, gap.previous);
  if (previous) return t('planEditor.pointPlacement.after', { section, point: previous });
  return section;
}

export function outlineSubpointPlacementWords(gap: OutlineSubpointGap, outline: SermonOutline, t: Translate): string {
  const section = findPointSection(outline, gap.parentId);
  const name = outlinePointText(outline, gap.parentId);
  if (!section || !name) return t('planEditor.pointPlacement.unavailable');
  const parent = [getSectionLabel(t, section), name].join(' · ');
  const next = gap.next && outlinePointText(outline, gap.next);
  if (next) return t('planEditor.pointPlacement.before', { section: parent, point: next });
  const previous = gap.previous && outlinePointText(outline, gap.previous);
  return previous ? t('planEditor.pointPlacement.after', { section: parent, point: previous }) : parent;
}

export function outlineParentPlacementWords(parent: NonNullable<ReturnType<typeof readOutlineParentComparison>>,
  identity: string, t: Translate, apply?: ApplyOutlineReview): TextComparison {
  const position = t('planEditor.pointPlacement.position');
  const names = parent.unresolvedMoves.map(({ child }) => outlinePointText(parent.opening, child.id)).join(', ');
  const words = (side: 'local' | 'remote') => parent.unresolvedMoves.map(move => {
    const target = move[side];
    const outline = side === 'local' ? parent.mine : parent.stored;
    const label = [getSectionLabel(t, target.section), outlinePointText(outline, target.point.id)].join(' · ');
    if (move.local.point.id !== move.remote.point.id) return label;
    const siblings = target.point.subPoints ?? [];
    const next = siblings[target.index + 1];
    const previous = siblings[target.index - 1];
    if (next) return t('planEditor.pointPlacement.before', { section: label, point: outlinePointText(outline, next.id) });
    return previous ? t('planEditor.pointPlacement.after', { section: label, point: outlinePointText(outline, previous.id) }) : label;
  }).join('\n');
  const titles = parent.titles.map(version => ({ ...version, label: [t(version.field === 'note' ? 'dataSync.outlinePointNote' : 'dataSync.outlinePointTitle'),
    outlinePointText(parent.opening, version.field === 'note' ? version.id.slice('note:'.length) : version.id)].filter(Boolean).join(' · ') }));
  return { identity, title: position + ' · ' + names, valueKind: 'field', scopedChoice: true,
    mine: words('local'), stored: words('remote'), ...(apply && titles.length > 0 && { outlineReview: { titles, apply, ...(parent.unresolvedMoves.length === 0 && { placementSettled: true }) } }) };
}

export function outlinePointConflictComparison(checkpoint: SessionCheckpoint, t: Translate, apply?: ApplyOutlineReview): TextComparison | undefined {
  const parent = readOutlineParentComparison(checkpoint);
  if (parent) return outlineParentPlacementWords(parent, JSON.stringify([parent.root, checkpoint.remoteCandidate?.metadata, checkpoint.editGeneration]), t, apply);
  const point = readOutlinePointPlacementComparison(checkpoint);
  if (!point) return undefined;
  const name = outlinePointText(point.outline, point.pointId);
  const position = t('planEditor.pointPlacement.position');
  return { identity: JSON.stringify([point.pointId, point.mine, point.saved, checkpoint.remoteCandidate?.metadata, checkpoint.editGeneration]),
    title: name ? position + ' · ' + name : position, valueKind: 'field', scopedChoice: true, keepMineDisabled: !point.available,
    mine: outlinePointPlacementWords(point.mine, point.outline, t),
    stored: outlinePointPlacementWords(point.saved, point.outline, t) };
}
