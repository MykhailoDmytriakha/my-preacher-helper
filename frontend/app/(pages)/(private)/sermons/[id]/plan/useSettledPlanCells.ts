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
    // Once the engine retires a removed card's draft, the screen's mirror must
    // stop presenting a second copy. Recovery has its own durable record.
    show(Object.fromEntries(removed.map(id => [id, live.has(id) ? saved[id] ?? '' : ''])));
  }, [document, drafts, show]);
}
