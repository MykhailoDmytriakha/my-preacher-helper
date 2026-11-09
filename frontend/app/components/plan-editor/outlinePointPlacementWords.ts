import { readOutlinePointPlacementComparison } from '@/data-engine/react.client';
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

export function outlinePointConflictComparison(checkpoint: SessionCheckpoint, t: Translate): TextComparison | undefined {
  const point = readOutlinePointPlacementComparison(checkpoint);
  if (!point) return undefined;
  const name = outlinePointText(point.outline, point.pointId);
  const position = t('planEditor.pointPlacement.position');
  return { identity: JSON.stringify([point.pointId, point.mine, point.saved, checkpoint.remoteCandidate?.metadata, checkpoint.editGeneration]),
    title: name ? position + ' · ' + name : position, valueKind: 'field', scopedChoice: true, keepMineDisabled: !point.available,
    mine: outlinePointPlacementWords(point.mine, point.outline, t),
    stored: outlinePointPlacementWords(point.saved, point.outline, t) };
}
