"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SERMON_PLAN_AGGREGATE } from "@/services/sermons.client";
import { newClientId } from "@/utils/clientId";
import { readDraftAddress } from "@/utils/draftAddress";
import { clearDraftIfMatches, draftKey, listDraftKeys, readDraft, readDraftsStrict, saveDraft, subscribeDraftCapture, type DurableDraft } from "@/utils/durableDraft";
import { planTransferCaptureScope, type PlanDraftBinding } from "@/utils/planDraftCapture.client";

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
  markCellAuthored: (nodeId: string, text: string) => void;
  cellAuthoringVersion: (nodeId: string) => number;
  holdCellAlternative: (nodeId: string, text: string) => ((keep: boolean) => void) | undefined;
  keepDetachedCell: (nodeId: string, text: string) => boolean;
  keepGeneratedCell: (nodeId: string, text: string) => boolean;
  prepareTransferCapture: (pointId: string, subPointId: string, parent: string, child: string) => string | undefined;
  orphaned: PlanOrphanCell[];
  forget: (cells: PlanOrphanCell[]) => void;
}

type AdoptedCell = Omit<PlanDraftCopy, 'sourceRecord'> & {
  sourceRecord?: DurableDraft<string>;
  seen: boolean;
  handoff?: { authoredAt: number; shown: string | undefined; interrupted: boolean };
};

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
    boundOwn: new Set<string>(), retiredOwn: new Set<string>(),
    cells: {} as Record<string, string>,
    authoring: 0, authored: new Map<string, { text: string; order: number }>(),
    content: {} as Record<string, string>, durableCells: null as Record<string, string> | null, adopted: new Map<string, AdoptedCell>(),
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
  session.adopted.forEach(copy => {
    const typed = unconfirmed[copy.id];
    const { handoff } = copy;
    const authored = session.authored.get(copy.id);
    const shown = contentByNodeId[copy.id];
    const continues = handoff && authored && authored.order >= handoff.authoredAt && authored.text === shown;
    if (handoff && shown !== handoff.shown) {
      handoff.shown = shown;
      // A generated or observed replacement ends this authoring chain. An edit
      // made afterwards may continue that replacement instead of the chosen copy.
      if (!continues) handoff.interrupted = true;
    }
    if (typed === copy.text || (typed !== undefined && typed === shown && continues && !handoff.interrupted)) copy.seen = true;
  });

  const persist = useCallback(() => {
    const { owner, documentId, writerId, cells, ours, owed } = session;
    if (!session.enabled || !owner || !documentId) return;
    Object.entries(cells).forEach(([id, text]) => {
      if (ours[id] === text) return;
      const key = cellKey(owner, documentId, id, writerId);
      if (saveDraft(key, text, undefined, true)) { ours[id] = text; delete owed[id]; }
      else owed[id] = text;
    });
    session.adopted.forEach((copy, key) => {
      if (!copy.seen) return;
      const current = session.content[copy.id];
      const saved = current !== undefined && !(copy.id in cells) && session.durableCells?.[copy.id] === current;
      // A selected alternative may be followed by authored words. A late generator
      // can replace a working cell, so only a proven author edit at a durable checkpoint
      // can retire its source.
      const authored = session.authored.get(copy.id);
      const handoff = copy.handoff;
      const transferred = handoff && !handoff.interrupted && authored && authored.order >= handoff.authoredAt && authored.text === current;
      if (!saved || (current !== copy.text && !transferred)) return;
      clearDraftIfMatches(key, copy.text, copy.sourceRecord);
      const remaining = readDraftsStrict([key]);
      if (remaining && !remaining.has(key)) session.adopted.delete(key);
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
  useEffect(() => subscribeDraftCapture(({ key }) => {
    const address = readDraftAddress(key);
    if (!address || address.owner !== session.owner || address.documentId !== session.documentId
      || !address.aggregate.startsWith(`${SERMON_PLAN_AGGREGATE}:`)) return;
    const remaining = readDraftsStrict([key]);
    if (!remaining || remaining.has(key)) return;
    session.adopted.delete(key);
    if (address.writerId === session.writerId) {
      const id = address.aggregate.slice(SERMON_PLAN_AGGREGATE.length + 1);
      session.boundOwn.delete(id);
      session.retiredOwn.add(id);
    }
    setFound(previous => previous?.session === session && previous.copies.some(copy => copy.key === key)
      ? { ...previous, copies: previous.copies.filter(copy => copy.key !== key) } : previous);
  }), [session]);
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
  const markCellAuthored = useCallback((id: string, text: string) => {
    const { owner, documentId, writerId, boundOwn, ours, owed } = session;
    if (boundOwn.delete(id) && session.enabled && owner && documentId) {
      // A new edit can return to the exact words carried by an earlier request.
      // Give this authored copy its own identity before the older ACK can retire it.
      delete ours[id];
      if (saveDraft(cellKey(owner, documentId, id, writerId), text, undefined, 'renew')) {
        ours[id] = text;
        delete owed[id];
      }
    }
    if (session.retiredOwn.delete(id)) delete session.ours[id];
    session.authored.set(id, { text, order: ++session.authoring });
  }, [session]);
  const cellAuthoringVersion = useCallback((id: string) => session.authored.get(id)?.order ?? 0, [session]);
  const prepareTransferCapture = useCallback((pointId: string, subPointId: string, parent: string, child: string) => {
    const { owner, documentId, writerId, ours, owed, cells } = session;
    if (!session.enabled || !owner || !documentId) return undefined;
    const transferred = new Map([[pointId, parent], [subPointId, child]]);
    const copies = [...transferred].flatMap<PlanDraftBinding>(([id, text]) => {
      const key = cellKey(owner, documentId, id, writerId);
      const stored = readDraft<string>(key);
      if (stored?.value === text && stored.captureToken) {
        session.boundOwn.add(id);
        return [{ key, proof: stored.captureToken }];
      }
      if (stored?.value !== text && cells[id] !== text) return [];
      if (!saveDraft(key, text, undefined, true)) return [];
      ours[id] = text;
      delete owed[id];
      const token = readDraft<string>(key)?.captureToken;
      if (token) session.boundOwn.add(id);
      return token ? [{ key, proof: token }] : [];
    });
    for (const [key, copy] of session.adopted) {
      if (copy.seen && copy.sourceRecord && transferred.get(copy.id) === copy.text) {
        copies.push({ key, proof: copy.sourceRecord.captureToken ?? copy.sourceRecord });
      }
    }
    return planTransferCaptureScope(pointId, subPointId, copies);
  }, [session]);
  const keepDetachedCell = useCallback((id: string, text: string) => {
    const { owner, documentId } = session;
    if (!session.enabled || !owner || !documentId) return false;
    const key = cellKey(owner, documentId, id, newClientId());
    if (!saveDraft(key, text, undefined, true)) return false;
    const sourceRecord = readDraft<string>(key);
    if (!sourceRecord) return false;
    const copy = { id, key, text, sourceRecord };
    setFound(previous => previous?.session === session
      ? { ...previous, copies: [...previous.copies, copy] }
      : previous);
    return true;
  }, [session]);
  const keepGeneratedCell = useCallback((id: string, text: string) => {
    const { owner, documentId, writerId, ours, owed } = session;
    if (!session.enabled || !owner || !documentId || !saveDraft(cellKey(owner, documentId, id, writerId), text, undefined, true)) return false;
    ours[id] = text;
    delete owed[id];
    return true;
  }, [session]);
  const holdCellAlternative = useCallback((id: string, text: string) => {
    const { owner, documentId } = session;
    if (!session.enabled || !owner || !documentId || selectionRef.current.session !== session) return;
    const key = cellKey(owner, documentId, id, newClientId());
    const saved = saveDraft(key, text, undefined, true);
    const sourceRecord = saved ? readDraft<string>(key) ?? undefined : undefined;
    return (keep: boolean) => {
      if (!session.enabled || selectionRef.current.session !== session) return;
      if (!keep) {
        clearDraftIfMatches(key, text, sourceRecord);
      } else {
        const authored = session.authored.get(id);
        const authoredAt = authored?.text === text ? authored.order : session.authoring + 1;
        session.adopted.set(key, {
          id, key, text, sourceRecord, seen: false,
          handoff: { authoredAt, shown: session.content[id], interrupted: false },
        });
      }
    };
  }, [session]);
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
  return useMemo(() => ({ recovered, copies, selectedCopies: selected, selectCopy, accept, discard, markCellAuthored, cellAuthoringVersion,
    holdCellAlternative, keepDetachedCell, keepGeneratedCell, prepareTransferCapture, orphaned, forget }),
    [accept, cellAuthoringVersion, copies, discard, forget, holdCellAlternative, keepDetachedCell, keepGeneratedCell, markCellAuthored, orphaned, prepareTransferCapture, recovered, selectCopy, selected]);
}
