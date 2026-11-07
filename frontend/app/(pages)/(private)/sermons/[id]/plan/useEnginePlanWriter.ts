import { useMemo } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERMON_PLAN_AGGREGATE } from '@/services/sermons.client';
import { liveNodeIds, readPlanText } from '@/utils/planText';

import { createEngineStructureWriter, editEngineSermon, useEngineStructureWriter } from '../structure/useEngineStructureWriter';

import type { PlanWriter } from './planWriter';
import type { StructureWriter } from '@/components/sermon/structureWriter';


type SermonDocument = ReturnType<typeof useDataDocument>;

/**
 * Plan writes on an engine document. A cell is written only if it still holds what the person
 * started from (`baselineByNodeId`), exactly like the legacy guard: a paragraph rewritten on
 * another device is reported with its current text, never overwritten. The refusal leaves the
 * draft untouched and surfaces as the StaleWriteError the plan screens already handle.
 */
export function createEnginePlanWriter(document: Pick<SermonDocument, 'update'>, owner: string | null, outlineWriter?: StructureWriter): PlanWriter {
  const structure = outlineWriter ?? createEngineStructureWriter(document, owner);
  return {
    updateThought: structure.updateThought,
    updateSermonOutline: structure.updateSermonOutline,
    savePlanMode: (_sermonId, mode) => editEngineSermon(document, owner, current => ({ next: { ...current, planMode: mode }, result: undefined })),
    savePlanText: async (_sermonId, changedText, removedNodeIds = [], context = {}) => {
      const conflicts = await editEngineSermon(document, owner, current => {
        const stored = current.planText ?? {};
        const baseline = context.baselineByNodeId;
        const compared = context.orphaned ? readPlanText(current) : stored;
        const live = context.orphaned ? liveNodeIds(current.outline) : undefined;
        const refused = Object.keys(changedText).filter(nodeId => live?.has(nodeId)
          || (baseline && (compared[nodeId] ?? null) !== (baseline[nodeId] ?? null) && (compared[nodeId] ?? null) !== changedText[nodeId]));
        if (refused.length) {
          return { next: current, result: Object.fromEntries(refused.map(nodeId => [`planText.${nodeId}`, compared[nodeId] ?? null])) };
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
export function useEnginePlanWriter(sermonId: string, owner: string | null) {
  const outlineRecovery = useEngineStructureWriter(sermonId, owner);
  const { document, writer: structure } = outlineRecovery;
  const lifetime = useMemo(() => ({ owner, sermonId, document: null as SermonDocument | null }), [owner, sermonId]);
  lifetime.document = document;
  const writer = useMemo(() => createEnginePlanWriter({ update: (fn, options) => lifetime.document!.update(fn, options) }, owner, structure),
    [lifetime, owner, structure]);
  return { writer, outlineRecovery };
}
