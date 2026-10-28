"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SERMON_PLAN_AGGREGATE } from "@/services/sermons.client";
import { newClientId } from "@/utils/clientId";
import { readDraftAddress } from "@/utils/draftAddress";
import { clearDraftIfMatches, draftKey, listDraftKeys, readDraft, readDraftsStrict, saveDraft } from "@/utils/durableDraft";

import { durablePlanCells, type DurablePlanState } from "./planDraftCheckpoint";

import type { PlanDraftCopy, PlanOrphanCell } from "./planDraftTypes";

/** One opening replaces only its own copy; discovery retains every other opening. */
export interface PlanTextDraft {
  recovered: Record<string, string> | null;
  copies: PlanDraftCopy[];
  selectedCopies: PlanDraftCopy[];
  selectCopy: (nodeId: string, key: string) => void;
  accept: () => void;
  discard: () => void;
  orphaned: PlanOrphanCell[];
  forget: (cells: PlanOrphanCell[]) => void;
}

const WRITE_DELAY_MS = 250;
const cellAggregate = (nodeId: string) => `${SERMON_PLAN_AGGREGATE}:${nodeId}`;
const cellKey = (owner: string, documentId: string, nodeId: string, writerId?: string) =>
  draftKey(owner, documentId, cellAggregate(nodeId), writerId);

/** Map only this feature's aggregate through the shared versioned address parser. */
function readStoredCells(owner: string, documentId: string): PlanDraftCopy[] {
  return listDraftKeys().flatMap(key => {
    const address = readDraftAddress(key);
    if (address?.owner !== owner || address.documentId !== documentId || !address.aggregate.startsWith(`${SERMON_PLAN_AGGREGATE}:`)) return [];
    const id = address.aggregate.slice(SERMON_PLAN_AGGREGATE.length + 1);
    const stored = readDraft<string>(key);
    return id && typeof stored?.value === "string" ? [{ id, key, text: stored.value, sourceRecord: stored }] : [];
  });
}

export default function usePlanTextDraft({
  uid, sermonId, contentByNodeId, modifiedNodeIds, pendingNodeIds, pendingText = {}, liveNodeIds, frozen = false, durableState,
}: {
  uid: string | null | undefined;
  sermonId: string | null | undefined;
  contentByNodeId: Record<string, string>;
  modifiedNodeIds: Record<string, boolean>;
  pendingNodeIds: Set<string>;
  pendingText?: Record<string, string>;
  liveNodeIds: Set<string>;
  frozen?: boolean;
  durableState?: DurablePlanState | null;
}): PlanTextDraft {
  // An old effect cleanup holds this exact session, never the incoming owner's refs.
  const session = useMemo(() => ({
    owner: uid, documentId: sermonId, writerId: newClientId(), enabled: false,
    typed: new Set<string>(), ours: {} as Record<string, string>, owed: {} as Record<string, string>,
    cells: {} as Record<string, string>,
    content: {} as Record<string, string>, durableCells: null as Record<string, string> | null, adopted: new Map<string, PlanDraftCopy & { seen: boolean }>(),
  }), [uid, sermonId]);
  session.enabled = Boolean(uid && sermonId) && !frozen;
  Object.entries(modifiedNodeIds).forEach(([id, dirty]) => { if (dirty) session.typed.add(id); });
  session.typed.forEach(id => { if (!modifiedNodeIds[id] && !pendingNodeIds.has(id)) session.typed.delete(id); });
  const unconfirmed = useMemo(() => {
    const cells: Record<string, string> = {};
    pendingNodeIds.forEach(id => {
      if (!liveNodeIds.has(id) && !(id in contentByNodeId)) return;
      if (session.typed.has(id) && id in contentByNodeId) cells[id] = contentByNodeId[id];
      else if (id in pendingText) cells[id] = pendingText[id];
      else if (id in contentByNodeId) cells[id] = contentByNodeId[id];
    });
    Object.entries(modifiedNodeIds).forEach(([id, dirty]) => { if (dirty) cells[id] = contentByNodeId[id] ?? ""; });
    return cells;
  }, [contentByNodeId, liveNodeIds, modifiedNodeIds, pendingNodeIds, pendingText, session]);
  session.cells = unconfirmed;
  session.content = contentByNodeId;
  session.durableCells = useMemo(() => durablePlanCells(durableState, uid, sermonId), [durableState, uid, sermonId]);
  session.adopted.forEach(copy => { if (unconfirmed[copy.id] === copy.text) copy.seen = true; });

  const persist = useCallback(() => {
    const { owner, documentId, writerId, cells, ours, owed } = session;
    if (!session.enabled || !owner || !documentId) return;
    Object.entries(cells).forEach(([id, text]) => {
      if (ours[id] === text) return;
      const key = cellKey(owner, documentId, id, writerId);
      if (saveDraft(key, text)) { ours[id] = text; delete owed[id]; }
      else owed[id] = text;
    });
    // A restored copy first becomes an actual dirty/queued value. It can retire
    // only when that same payload settles through the existing durable write path.
    session.adopted.forEach((copy, key) => {
      if (copy.seen && !(copy.id in cells) && session.content[copy.id] === copy.text && session.durableCells?.[copy.id] === copy.text) {
        clearDraftIfMatches(key, copy.text, copy.sourceRecord);
        const remaining = readDraftsStrict([key]);
        if (remaining && !remaining.has(key)) session.adopted.delete(key);
      }
    });
    // Only this opening's exact copies retire when its edit settles.
    [ours, owed].forEach(known => Object.keys(known).forEach(id => {
      if (id in cells || session.durableCells?.[id] !== known[id]) return;
      clearDraftIfMatches(cellKey(owner, documentId, id, writerId), known[id]);
      delete known[id];
    }));
  }, [session]);
  useEffect(() => {
    if (!session.enabled) return;
    const timer = setTimeout(persist, WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [durableState, frozen, persist, session, unconfirmed]);
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onHidden);
      persist();
    };
  }, [persist]);

  const [found, setFound] = useState<{ session: typeof session; copies: PlanDraftCopy[]; selected: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!session.owner || !session.documentId) return;
    setFound({ session, copies: readStoredCells(session.owner, session.documentId), selected: {} });
  }, [session]);
  const copies = useMemo(() => found?.session === session ? found.copies : [], [found, session]);
  const selected = useMemo(() => {
    const chosen = new Map<string, PlanDraftCopy>();
    copies.forEach(copy => {
      if (!liveNodeIds.has(copy.id)) return;
      if (!chosen.has(copy.id) || found?.selected[copy.id] === copy.key) chosen.set(copy.id, copy);
    });
    return [...chosen.values()];
  }, [copies, found, liveNodeIds]);
  const recovered = useMemo(() => selected.length ? Object.fromEntries(selected.map(copy => [copy.id, copy.text])) : null, [selected]);
  const selectionRef = useRef({ session, selected });
  selectionRef.current = { session, selected };
  const selectCopy = useCallback((nodeId: string, key: string) => {
    setFound(previous => previous?.session === session && previous.copies.some(copy => copy.id === nodeId && copy.key === key)
      ? { ...previous, selected: { ...previous.selected, [nodeId]: key } } : previous);
  }, [session]);
  const settle = useCallback((discard: boolean) => {
    if (!session.enabled || selectionRef.current.session !== session) return;
    const shown = selectionRef.current.selected;
    if (discard) shown.forEach(copy => clearDraftIfMatches(copy.key, copy.text));
    else shown.forEach(copy => session.adopted.set(copy.key, { ...copy, seen: session.cells[copy.id] === copy.text }));
    const keys = new Set(shown.map(copy => copy.key));
    setFound(previous => previous?.session === session ? { ...previous, copies: previous.copies.filter(copy => !keys.has(copy.key)) } : previous);
  }, [session]);
  const accept = useCallback(() => settle(false), [settle]);
  const discard = useCallback(() => settle(true), [settle]);
  const orphaned = useMemo(() => copies.filter(copy => !liveNodeIds.has(copy.id) && copy.text.trim() !== "")
    .map(copy => ({ id: copy.id, text: copy.text, copyKey: copy.key })), [copies, liveNodeIds]);
  const forget = useCallback((shown: PlanOrphanCell[]) => {
    const { owner, documentId, writerId } = session;
    if (!session.enabled || !owner || !documentId) return;
    const forgotten = new Set<string>();
    shown.forEach(cell => {
      const key = cell.copyKey ?? cellKey(owner, documentId, cell.id, writerId);
      const address = readDraftAddress(key);
      if (address?.owner !== owner || address.documentId !== documentId || address.aggregate !== cellAggregate(cell.id)) return;
      clearDraftIfMatches(key, cell.text);
      forgotten.add(key);
      if (key === cellKey(owner, documentId, cell.id, writerId)) {
        delete session.ours[cell.id]; delete session.owed[cell.id];
      }
    });
    setFound(previous => previous?.session === session ? { ...previous, copies: previous.copies.filter(copy => !forgotten.has(copy.key)) } : previous);
  }, [session]);
  return useMemo(() => ({ recovered, copies, selectedCopies: selected, selectCopy, accept, discard, orphaned, forget }),
    [accept, copies, discard, forget, orphaned, recovered, selectCopy, selected]);
}
