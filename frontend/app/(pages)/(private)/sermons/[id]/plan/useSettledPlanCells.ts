import { useEffect, useRef } from 'react';

import { liveNodeIds, readPlanText } from '@/utils/planText';

import type { DurablePlanState } from './planDraftCheckpoint';
import type { Sermon } from '@/models/models';

export function useSettledPlanCells(state: DurablePlanState | null | undefined, show: (cells: Record<string, string>) => void) {
  const drafts = state?.checkpoint.planCellDrafts;
  const document = state?.checkpoint.draft as Sermon | null | undefined;
  const previous = useRef(drafts);
  useEffect(() => {
    const owned = previous.current;
    previous.current = drafts;
    if (!owned || !document) return;
    const removed = Object.keys(owned).filter(id => !drafts?.[id]);
    if (!removed.length) return;
    const live = liveNodeIds(document.outline);
    const saved = readPlanText(document);
    const settled = removed.filter(id => live.has(id)).map(id => [id, saved[id] ?? '']);
    if (settled.length) show(Object.fromEntries(settled));
  }, [document, drafts, show]);
}
