import { useMemo } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERMON_PLAN_AGGREGATE } from '@/services/sermons.client';
import { liveNodeIds, readPlanText } from '@/utils/planText';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { findOutlinePointLocation } from '@/utils/subPoints';

import { createEngineStructureWriter, editEngineSermon, useEngineStructureWriter } from '../structure/useEngineStructureWriter';

import type { PlanMode, PlanWriter } from './planWriter';
import type { StructureWriter } from '@/components/sermon/structureWriter';
import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import type { Sermon } from '@/models/models';


type SermonDocument = ReturnType<typeof useDataDocument>;

/**
 * Plan writes on an engine document. A cell is written only if it still holds what the person
 * started from (`baselineByNodeId`), exactly like the legacy guard: a paragraph rewritten on
 * another device is reported with its current text, never overwritten. The refusal leaves the
 * draft untouched and surfaces as the StaleWriteError the plan screens already handle.
 */
export function createEnginePlanWriter(document: Pick<SermonDocument, 'update' | 'commit' | 'captureSermonPlanMode' | 'save'>, owner: string | null, outlineWriter?: StructureWriter): PlanWriter {
  const structure = outlineWriter ?? createEngineStructureWriter(document, owner);
  const prepareMode = (sermonId: string, mode: PlanMode, initialize?: true) => {
    const capture = document.captureSermonPlanMode();
    return async () => {
      if (!capture) {
        if (initialize) return;
        throw new Error('Sermon editor is unavailable');
      }
      if (capture.seen.sermonId !== sermonId) throw new Error('Sermon editor is unavailable');
      if (initialize && capture.seen.value.exists) return;
      await document.commit(current => {
        if (!current || !owner || current.userId !== owner || (current.id !== undefined && current.id !== sermonId)) throw new Error('Sermon editor is unavailable');
        return { ...current, planMode: mode };
      }, { kind: 'sermon-plan-mode', mode: initialize ? { ...capture, time: null, initialize } : capture });
    };
  };
  return {
    updateThought: structure.updateThought,
    updateSermonOutline: structure.updateSermonOutline,
    captureOutlineUpdate: () => document.save(),
    removeSubPoint: (sermonId, pointId, subPointId) => editEngineSermon<Awaited<ReturnType<PlanWriter['removeSubPoint']>>>({ update: updater => document.commit(updater) }, owner, current => {
      if (current.id !== undefined && current.id !== sermonId) throw new Error('Sermon editor is unavailable');
      const outline = current.outline;
      const location = findOutlinePointLocation(outline, pointId);
      const children = location?.outlinePoint.subPoints;
      if (!outline || !location || !children?.some(sub => sub.id === subPointId)) {
        return { next: current, result: {
          kind: 'absent', outline: outline ?? null, parentText: location ? readPlanText(current)[pointId] ?? '' : undefined,
        } };
      }
      const { section, outlinePoint } = location;
      const updated = { ...outlinePoint, subPoints: children.filter(sub => sub.id !== subPointId) };
      const changedOutline = { ...outline,
        [section]: outline[section].map(point => point.id === pointId ? updated : point),
      };
      return { next: replaceSermonOutline(current, changedOutline), result: { kind: 'removed', outline: changedOutline } };
    }),
    preparePlanMode: prepareMode,
    savePlanMode: async (sermonId, mode) => prepareMode(sermonId, mode)(),
    initializePlanMode: async (sermonId, mode) => prepareMode(sermonId, mode, true)(),
    savePlanText: async (_sermonId, changedText, removedNodeIds = [], context = {}) => {
      const openings = context.revisionsByNodeId;
      const update = (value: DocumentData | null, confirmed?: ResourceSnapshot) => {
        if (!value || !owner || value.userId !== owner) throw new Error('Sermon editor is unavailable');
        const current = value as unknown as Sermon;
        const stored = current.planText ?? {};
        const baseline = context.baselineByNodeId;
        const compared = context.orphaned ? readPlanText(current) : stored;
        const live = context.orphaned ? liveNodeIds(current.outline) : undefined;
        const refused = Object.keys(changedText).filter(nodeId => live?.has(nodeId)
          || (baseline && (compared[nodeId] ?? null) !== (baseline[nodeId] ?? null) && (compared[nodeId] ?? null) !== changedText[nodeId]));
        if (refused.length) {
          const fields = Object.fromEntries(refused.map(nodeId => [`planText.${nodeId}`, compared[nodeId] ?? null]));
          const confirmedSermon = confirmed?.value as unknown as Sermon | undefined;
          const saved = context.orphaned ? readPlanText(confirmedSermon) : confirmedSermon?.planText;
          const exact = confirmedSermon && refused.every(id => (saved?.[id] ?? null) === (compared[id] ?? null));
          throw new StaleWriteError(SERMON_PLAN_AGGREGATE, 0, 0, fields, [], undefined, exact ? confirmed?.metadata?.revision : undefined);
        }
        const planText = { ...stored, ...changedText };
        removedNodeIds.forEach(nodeId => { delete planText[nodeId]; });
        return { ...value, planText };
      };
      if (openings) await document.commit(update, { kind: 'sermon-plan-text', openings });
      else await document.update(update);
    },
  };
}

/** The engine plan writer for one open sermon; render inside that sermon's DataDocumentProvider. */
export function useEnginePlanWriter(sermonId: string, owner: string | null) {
  const outlineRecovery = useEngineStructureWriter(sermonId, owner);
  const { writeTarget, writer: structure } = outlineRecovery;
  const writer = useMemo(() => createEnginePlanWriter(writeTarget, owner, structure),
    [writeTarget, owner, structure]);
  return { writer, outlineRecovery };
}
