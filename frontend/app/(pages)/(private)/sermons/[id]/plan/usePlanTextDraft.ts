"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SERMON_PLAN_AGGREGATE } from "@/services/sermons.client";
import { readDraftAddress } from "@/utils/draftAddress";
import { clearDraftIfMatches, listDraftKeys, readDraft, readDraftsStrict, subscribeDraftCapture } from "@/utils/durableDraft";
import { planTransferCaptureScope, type PlanDraftBinding } from "@/utils/planDraftCapture.client";

import type { PlanDraftCopy, PlanOrphanCell } from "./planDraftTypes";

export interface PlanCellBackupAuthority {
  bindPlanCellBackups?(cells: Readonly<Record<string, string>>): PlanDraftBinding[];
}

const aggregatePrefix = `${SERMON_PLAN_AGGREGATE}:`;

function planDraftNode(key: string, owner: string | null | undefined, documentId: string | null | undefined) {
  const address = readDraftAddress(key);
  if (address && address.owner === owner && address.documentId === documentId && address.aggregate.startsWith(aggregatePrefix)) {
    return address.aggregate.slice(aggregatePrefix.length) || null;
  }
  return null;
}

function readStoredCells(owner: string, documentId: string): PlanDraftCopy[] {
  return listDraftKeys().flatMap(key => {
    const id = planDraftNode(key, owner, documentId);
    if (!id) return [];
    const stored = readDraft<string>(key);
    return typeof stored?.value === "string" ? [{ id, key, text: stored.value, sourceRecord: stored }] : [];
  });
}

/** Read older and emergency copies. New draft writes are owned by the active document session. */
export default function usePlanTextDraft({
  uid, sermonId, liveNodeIds, frozen = false, backupAuthority,
}: {
  uid: string | null | undefined;
  sermonId: string | null | undefined;
  liveNodeIds: Set<string>;
  frozen?: boolean;
  backupAuthority?: PlanCellBackupAuthority;
}) {
  const scope = useMemo(() => ({ owner: uid, documentId: sermonId, authored: new Map<string, number>() }), [uid, sermonId]);
  const current = useRef({ scope, frozen, backupAuthority });
  current.current = { scope, frozen, backupAuthority };
  const [found, setFound] = useState<{ scope: typeof scope; copies: PlanDraftCopy[]; selected: Record<string, string> } | null>(null);
  const refreshLegacy = useCallback(() => {
    if (current.current.scope !== scope || !scope.owner || !scope.documentId) return;
    const copies = readStoredCells(scope.owner, scope.documentId);
    setFound(previous => ({ scope, copies, selected: previous?.scope === scope ? previous.selected : {} }));
  }, [scope]);
  useEffect(refreshLegacy, [refreshLegacy]);

  const removeOffers = useCallback((keys: readonly string[]) => {
    if (!keys.length) return;
    const remaining = readDraftsStrict(keys);
    if (!remaining) return;
    const retired = new Set(keys.filter(key => !remaining.has(key)));
    if (retired.size) setFound(previous => previous?.scope === scope
      ? { ...previous, copies: previous.copies.filter(copy => !retired.has(copy.key)) } : previous);
  }, [scope]);
  useEffect(() => subscribeDraftCapture(({ key }) => {
    if (planDraftNode(key, scope.owner, scope.documentId)) removeOffers([key]);
  }), [removeOffers, scope]);

  const copies = useMemo(() => found?.scope === scope ? found.copies : [], [found, scope]);
  const selected = useMemo(() => {
    const chosen = new Map<string, PlanDraftCopy>();
    for (const copy of copies) {
      if (!liveNodeIds.has(copy.id)) continue;
      if (!chosen.has(copy.id) || found?.selected[copy.id] === copy.key) chosen.set(copy.id, copy);
    }
    return [...chosen.values()];
  }, [copies, found, liveNodeIds]);
  const recovered = useMemo(() => selected.length ? Object.fromEntries(selected.map(copy => [copy.id, copy.text])) : null, [selected]);
  const orphaned = useMemo(() => copies.filter(copy => !liveNodeIds.has(copy.id) && copy.text.trim() !== "")
    .map(copy => ({ id: copy.id, text: copy.text, copyKey: copy.key })), [copies, liveNodeIds]);

  const selectCopy = useCallback((nodeId: string, key: string) => {
    setFound(previous => previous?.scope === scope && previous.copies.some(copy => copy.id === nodeId && copy.key === key)
      ? { ...previous, selected: { ...previous.selected, [nodeId]: key } } : previous);
  }, [scope]);
  const accept = useCallback((transferred: readonly PlanDraftCopy[]) => {
    if (current.current.scope !== scope || current.current.frozen) return;
    const addressed = transferred.filter(copy => planDraftNode(copy.key, scope.owner, scope.documentId) === copy.id);
    for (const copy of addressed) clearDraftIfMatches(copy.key, copy.text, copy.sourceRecord);
    removeOffers(addressed.map(copy => copy.key));
  }, [removeOffers, scope]);
  const discard = useCallback(() => accept(selected), [accept, selected]);
  const forget = useCallback((shown: PlanOrphanCell[]) => accept(shown.flatMap(cell => {
    const presented = copies.find(copy => copy.key === cell.copyKey && copy.id === cell.id && copy.text === cell.text);
    return presented ? [presented] : [];
  })), [accept, copies]);

  const markCellAuthored = useCallback((id: string) => {
    scope.authored.set(id, (scope.authored.get(id) ?? 0) + 1);
  }, [scope]);
  const cellAuthoringVersion = useCallback((id: string) => scope.authored.get(id) ?? 0, [scope]);
  const prepareTransferCapture = useCallback((pointId: string, subPointId: string, parent: string, child: string) => {
    if (current.current.scope !== scope || current.current.frozen || !scope.owner || !scope.documentId) return;
    const bindings = current.current.backupAuthority?.bindPlanCellBackups?.({ [pointId]: parent, [subPointId]: child }) ?? [];
    return planTransferCaptureScope(pointId, subPointId, bindings);
  }, [scope]);

  return useMemo(() => ({ recovered, copies, selectedCopies: selected, selectCopy, accept, discard, markCellAuthored, cellAuthoringVersion,
    refreshLegacy, prepareTransferCapture, orphaned, forget }),
    [accept, cellAuthoringVersion, copies, discard, forget, markCellAuthored, orphaned, prepareTransferCapture, recovered, refreshLegacy, selectCopy, selected]);
}
