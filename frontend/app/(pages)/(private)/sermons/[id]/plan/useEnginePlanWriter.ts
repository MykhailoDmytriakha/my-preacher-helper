import { useMemo, useRef } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERMON_PLAN_AGGREGATE } from '@/services/sermons.client';

import { createEngineStructureWriter, editEngineSermon } from '../structure/useEngineStructureWriter';

import type { PlanWriter } from './planWriter';

type SermonDocument = ReturnType<typeof useDataDocument>;

/**
 * Plan writes on an engine document. A cell is written only if it still holds what the person
 * started from (`baselineByNodeId`), exactly like the legacy guard: a paragraph rewritten on
 * another device is reported with its current text, never overwritten. The refusal leaves the
 * draft untouched and surfaces as the StaleWriteError the plan screens already handle.
 */
export function createEnginePlanWriter(document: Pick<SermonDocument, 'update'>, owner: string | null): PlanWriter {
  const structure = createEngineStructureWriter(document, owner);
  return {
    updateThought: structure.updateThought,
    updateSermonOutline: structure.updateSermonOutline,
    savePlanMode: (_sermonId, mode) => editEngineSermon(document, owner, current => ({ next: { ...current, planMode: mode }, result: undefined })),
    savePlanText: async (_sermonId, changedText, removedNodeIds = [], context = {}) => {
      const conflicts = await editEngineSermon(document, owner, current => {
        const stored = current.planText ?? {};
        const baseline = context.baselineByNodeId;
        const refused = baseline ? Object.keys(changedText).filter(nodeId =>
          (stored[nodeId] ?? null) !== (baseline[nodeId] ?? null) && (stored[nodeId] ?? null) !== changedText[nodeId]) : [];
        if (refused.length) {
          return { next: current, result: Object.fromEntries(refused.map(nodeId => [`planText.${nodeId}`, stored[nodeId] ?? null])) };
        }
        const planText = { ...stored, ...changedText };
        removedNodeIds.forEach(nodeId => { delete planText[nodeId]; });
        return { next: { ...current, planText }, result: null };
      });
      if (conflicts) throw new StaleWriteError(SERMON_PLAN_AGGREGATE, 0, 0, conflicts);
    },
  };
}

/** The engine plan writer for one open sermon; render inside that sermon's DataDocumentProvider. */
export function useEnginePlanWriter(sermonId: string, owner: string | null): PlanWriter {
  const document = useDataDocument({ collection: 'sermons', id: sermonId });
  const latest = useRef(document);
  latest.current = document;
  return useMemo(() => createEnginePlanWriter({ update: fn => latest.current.update(fn) }, owner), [owner]);
}
