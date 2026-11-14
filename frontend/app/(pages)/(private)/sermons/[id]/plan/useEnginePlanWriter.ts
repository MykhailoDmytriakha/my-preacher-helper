import { useMemo } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERMON_PLAN_AGGREGATE } from '@/services/sermons.client';
import { liveNodeIds, readPlanText } from '@/utils/planText';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { findOutlinePointLocation } from '@/utils/subPoints';

import { createEngineStructureWriter, editEngineSermon, useEngineStructureWriter } from '../structure/useEngineStructureWriter';

import type { PlanMode, PlanTextContext, PlanWriter, SubpointTextTransfer } from './planWriter';
import type { StructureWriter } from '@/components/sermon/structureWriter';
import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import type { Sermon } from '@/models/models';


type SermonDocument = ReturnType<typeof useDataDocument>;
type StagedCell = { before: string | null; text: string };

function continueTransfer(transfer: SubpointTextTransfer, pointId: string, subPointId: string, staged: ReadonlyMap<string, StagedCell>): SubpointTextTransfer {
  const earlier = (id: string) => {
    const cell = staged.get(id);
    return cell && cell.before === transfer.baselineByNodeId[id] ? cell.text : undefined;
  };
  const parent = earlier(pointId), child = earlier(subPointId);
  return {
    ...transfer,
    parentOpeningText: parent ?? transfer.parentOpeningText,
    openingText: child ?? transfer.openingText,
    baselineByNodeId: {
      ...transfer.baselineByNodeId,
      ...(parent !== undefined && { [pointId]: parent }),
      ...(child !== undefined && { [subPointId]: child }),
    },
  };
}

function guardPlanText(current: Sermon, changed: Record<string, string>, context: PlanTextContext, confirmed?: ResourceSnapshot) {
  const stored = current.planText ?? {};
  const baseline = context.baselineByNodeId;
  const compared = context.orphaned ? readPlanText(current) : stored;
  const live = context.orphaned ? liveNodeIds(current.outline) : undefined;
  const refused = Object.keys(changed).filter(nodeId => live?.has(nodeId)
    || (baseline && (compared[nodeId] ?? null) !== (baseline[nodeId] ?? null) && (compared[nodeId] ?? null) !== changed[nodeId]));
  if (refused.length) {
    const fields = Object.fromEntries(refused.map(nodeId => [`planText.${nodeId}`, compared[nodeId] ?? null]));
    const confirmedSermon = confirmed?.value as unknown as Sermon | undefined;
    const saved = context.orphaned ? readPlanText(confirmedSermon) : confirmedSermon?.planText;
    const exact = confirmedSermon && refused.every(id => (saved?.[id] ?? null) === (compared[id] ?? null));
    throw new StaleWriteError(SERMON_PLAN_AGGREGATE, 0, 0, fields, [], undefined, exact ? confirmed?.metadata?.revision : undefined);
  }
  return stored;
}

/**
 * Plan writes on an engine document. A cell is written only if it still holds what the person
 * started from (`baselineByNodeId`), exactly like the legacy guard: a paragraph rewritten on
 * another device is reported with its current text, never overwritten. The refusal leaves the
 * draft untouched and surfaces as the StaleWriteError the plan screens already handle.
 */
export function createEnginePlanWriter(document: Pick<SermonDocument, 'update' | 'commit' | 'captureSermonPlanMode' | 'save'>, owner: string | null, outlineWriter?: StructureWriter): PlanWriter {
  const structure = outlineWriter ?? createEngineStructureWriter(document, owner);
  // The engine's draft shows a Save before its local capture callback returns.
  // Only writes staged here can advance the displayed opening of the next action.
  const stagedCells = new Map<string, StagedCell>();
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
    removeSubPoint: (sermonId, pointId, subPointId, requestedTransfer) => {
      const transfer = requestedTransfer && continueTransfer(requestedTransfer, pointId, subPointId, stagedCells);
      return editEngineSermon<Awaited<ReturnType<PlanWriter['removeSubPoint']>>>({
        update: updater => document.commit(updater, transfer && { kind: 'sermon-plan-text', openings: transfer.revisionsByNodeId,
          transfer: { pointId, subPointId, openingText: transfer.openingText, parentOpeningText: transfer.parentOpeningText } }),
      }, owner, current => {
        if (current.id !== undefined && current.id !== sermonId) throw new Error('Sermon editor is unavailable');
        const outline = current.outline;
        const location = findOutlinePointLocation(outline, pointId);
        const children = location?.outlinePoint.subPoints;
        if (!outline || !location || !children?.some(sub => sub.id === subPointId)) {
          const displayed = readPlanText(current);
          return { next: current, result: {
            kind: 'absent', outline: outline ?? null, parentText: location ? displayed[pointId] ?? '' : undefined,
            sourceText: displayed[subPointId],
          } };
        }
        const { section, outlinePoint } = location;
        const updated = { ...outlinePoint, subPoints: children.filter(sub => sub.id !== subPointId) };
        const changedOutline = { ...outline,
          [section]: outline[section].map(point => point.id === pointId ? updated : point),
        };
        const updatedSermon = replaceSermonOutline(current, changedOutline);
        if (transfer) {
          const changed = { [pointId]: transfer.parentText, [subPointId]: '' };
          const stored = guardPlanText(current, changed, transfer);
          const displayed = readPlanText(current);
          const changedOpenings = [[pointId, transfer.parentOpeningText], [subPointId, transfer.openingText]]
            .filter(([id, opening]) => (displayed[id] ?? '') !== opening);
          if (changedOpenings.length) {
            const fields = Object.fromEntries(changedOpenings.map(([id]) => [`planText.${id}`, displayed[id] ?? null]));
            throw new StaleWriteError(SERMON_PLAN_AGGREGATE, 0, 0, fields, []);
          }
          updatedSermon.planText = { ...stored, ...changed };
        }
        return { next: updatedSermon, result: { kind: 'removed', outline: changedOutline } };
      });
    },
    preparePlanMode: prepareMode,
    savePlanMode: async (sermonId, mode) => prepareMode(sermonId, mode)(),
    initializePlanMode: async (sermonId, mode) => prepareMode(sermonId, mode, true)(),
    savePlanText: async (_sermonId, changedText, removedNodeIds = [], context = {}) => {
      const openings = context.revisionsByNodeId;
      const staged = new Map<string, StagedCell>();
      const update = (value: DocumentData | null, confirmed?: ResourceSnapshot) => {
        if (!value || !owner || value.userId !== owner) throw new Error('Sermon editor is unavailable');
        const current = value as unknown as Sermon;
        const stored = guardPlanText(current, changedText, context, confirmed);
        const planText = { ...stored, ...changedText };
        removedNodeIds.forEach(nodeId => { delete planText[nodeId]; });
        if (openings) for (const [id, text] of Object.entries(changedText)) {
          const before = stored[id] ?? null;
          if (before === text || planText[id] !== text) continue;
          const cell = { before, text };
          staged.set(id, cell);
          stagedCells.set(id, cell);
        }
        return { ...value, planText };
      };
      try {
        if (openings) await document.commit(update, { kind: 'sermon-plan-text', openings });
        else await document.update(update);
      } finally {
        for (const [id, cell] of staged) if (stagedCells.get(id) === cell) stagedCells.delete(id);
      }
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
