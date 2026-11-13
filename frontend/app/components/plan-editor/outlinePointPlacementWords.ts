import { readOutlineParentComparison, readOutlinePointPlacementComparison } from '@/data-engine/react.client';
import { outlinePointText } from '@/utils/outlineDnd';
import { getSectionLabel } from '@lib/sections';

import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { SermonOutline } from '@/models/models';
import type { OutlinePointGap } from '@/utils/outlineDnd';

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

export function outlineParentPlacementWords(parent: NonNullable<ReturnType<typeof readOutlineParentComparison>>,
  identity: string, t: Translate): TextComparison {
  const position = t('planEditor.pointPlacement.position');
  const names = parent.moves.map(({ child }) => outlinePointText(parent.opening, child.id)).join(', ');
  const words = (side: 'local' | 'remote') => parent.moves.map(move => {
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
  return { identity, title: position + ' · ' + names, valueKind: 'field', scopedChoice: true,
    mine: words('local'), stored: words('remote') };
}

export function outlinePointConflictComparison(checkpoint: SessionCheckpoint, t: Translate): TextComparison | undefined {
  const parent = readOutlineParentComparison(checkpoint);
  if (parent) return outlineParentPlacementWords(parent, JSON.stringify([parent.root, checkpoint.remoteCandidate?.metadata, checkpoint.editGeneration]), t);
  const point = readOutlinePointPlacementComparison(checkpoint);
  if (!point) return undefined;
  const name = outlinePointText(point.outline, point.pointId);
  const position = t('planEditor.pointPlacement.position');
  return { identity: JSON.stringify([point.pointId, point.mine, point.saved, checkpoint.remoteCandidate?.metadata, checkpoint.editGeneration]),
    title: name ? position + ' · ' + name : position, valueKind: 'field', scopedChoice: true, keepMineDisabled: !point.available,
    mine: outlinePointPlacementWords(point.mine, point.outline, t),
    stored: outlinePointPlacementWords(point.saved, point.outline, t) };
}
