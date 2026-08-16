"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SERMON_PLAN_AGGREGATE } from "@/services/sermons.client";
import {
  clearDraftIfMatches,
  draftKey,
  listDraftKeys,
  readDraft,
  saveDraft,
} from "@/utils/durableDraft";

/**
 * THE PLAN'S TEXT MUST SURVIVE A CLOSED TAB — the precondition the write guard states about
 * itself: refusing a stale save is only an improvement while the refused text lives somewhere
 * that outlives the tab. Otherwise the mechanism has merely moved the loss from the other
 * person's paragraph to this one's.
 *
 * ⚠️ ONE KEY PER CELL, AND THAT IS THE WHOLE DESIGN DECISION.
 *
 * This first went through the shared `useDurableDraft`, which keeps ONE value per document —
 * exactly right for a note body, and wrong here in three ways that each cost text, all of them
 * caused by storing a MAP in a slot built for a scalar:
 *
 *   - the screen mounts before its cells are seeded, so for one render the recovered draft was
 *     the only thing that looked unconfirmed; that instant became the "this is what the server
 *     has" baseline, and 250ms later an empty map was written over the draft. The offer sat on
 *     screen with nothing behind it.
 *   - two tabs on one sermon share the slot, and each wrote its whole map: whichever typed last
 *     erased the other tab's unconfirmed paragraph.
 *   - discarding compared the stored map against the FILTERED offer, so it deleted cells the
 *     person had never been shown.
 *
 * Per cell, all three stop existing rather than being defended against: independent cells never
 * touch each other's key, "what was shown" and "what is deleted" are the same thing, and there
 * is no shared baseline to capture at the wrong moment. Two tabs editing THE SAME cell still
 * share one key — and there the last writer really is the newer text.
 */
export interface PlanTextDraft {
  /** Unconfirmed cells found in storage when this screen opened, or null. */
  recovered: Record<string, string> | null;
  /** Hand the recovered cells to the editor; the stored copies are KEPT until saved. */
  accept: () => void;
  /** The person does not want them. Deletes exactly the cells that were offered — no others. */
  discard: () => void;
}

/** How long to coalesce keystrokes before touching storage. */
const WRITE_DELAY_MS = 250;

const cellAggregate = (nodeId: string) => `${SERMON_PLAN_AGGREGATE}:${nodeId}`;

function cellKey(uid: string, sermonId: string, nodeId: string): string {
  return draftKey(uid, sermonId, cellAggregate(nodeId));
}

/** Every cell this sermon has a stored draft for, keyed by node id. */
function readStoredCells(uid: string, sermonId: string): Record<string, string> {
  const prefix = draftKey(uid, sermonId, `${SERMON_PLAN_AGGREGATE}:`);
  const found: Record<string, string> = {};
  listDraftKeys().forEach((key) => {
    if (!key.startsWith(prefix)) return;
    const stored = readDraft<string>(key);
    if (typeof stored?.value === "string") found[key.slice(prefix.length)] = stored.value;
  });
  return found;
}

export default function usePlanTextDraft({
  uid,
  sermonId,
  contentByNodeId,
  modifiedNodeIds,
  pendingNodeIds,
  liveNodeIds,
}: {
  uid: string | null | undefined;
  sermonId: string | null | undefined;
  contentByNodeId: Record<string, string>;
  modifiedNodeIds: Record<string, boolean>;
  /** Cells whose write is queued offline — unconfirmed, however clean the screen looks. */
  pendingNodeIds: Set<string>;
  /** Nodes the outline still has. A draft for anything else has nowhere to be shown. */
  liveNodeIds: Set<string>;
}): PlanTextDraft {
  const enabled = Boolean(uid && sermonId);

  /**
   * UNCONFIRMED MEANS TWO THINGS, and both belong here: being typed right now, and sitting in
   * the offline queue — which is precisely "written, but no server has seen it". The second is
   * the one that used to be missed, and missing it is how the words written on a train stopped
   * existing anywhere the person could look.
   */
  const unconfirmed = useMemo(() => {
    const cells: Record<string, string> = {};
    Object.entries(modifiedNodeIds).forEach(([nodeId, isDirty]) => {
      if (isDirty) cells[nodeId] = contentByNodeId[nodeId] ?? "";
    });
    pendingNodeIds.forEach((nodeId) => {
      if (nodeId in contentByNodeId) cells[nodeId] = contentByNodeId[nodeId];
    });
    return cells;
  }, [contentByNodeId, modifiedNodeIds, pendingNodeIds]);

  /** What THIS screen last stored per cell, so it can retire its own writes and no one else's. */
  const oursRef = useRef<Record<string, string>>({});
  const unconfirmedRef = useRef(unconfirmed);
  unconfirmedRef.current = unconfirmed;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const addressRef = useRef({ uid, sermonId });
  addressRef.current = { uid, sermonId };

  const persist = useCallback(() => {
    const { uid: owner, sermonId: docId } = addressRef.current;
    if (!enabledRef.current || !owner || !docId) return;

    const cells = unconfirmedRef.current;
    Object.entries(cells).forEach(([nodeId, text]) => {
      if (oursRef.current[nodeId] === text) return;
      saveDraft(cellKey(owner, docId, nodeId), text);
      oursRef.current[nodeId] = text;
    });

    /**
     * A CELL WE STORED AND NO LONGER HOLD IS CONFIRMED — retire OUR copy of it, and only ours.
     * `clearDraftIfMatches` compares first, so if another tab has since put its own unconfirmed
     * text under that key, it is left exactly where it is.
     */
    Object.keys(oursRef.current).forEach((nodeId) => {
      if (nodeId in cells) return;
      clearDraftIfMatches(cellKey(owner, docId, nodeId), oursRef.current[nodeId]);
      delete oursRef.current[nodeId];
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const timeoutId = setTimeout(persist, WRITE_DELAY_MS);
    return () => clearTimeout(timeoutId);
  }, [enabled, persist, unconfirmed]);

  /**
   * The page can go away before the debounce fires, and that is exactly when the last few
   * hundred milliseconds of typing matter. `pagehide` covers tab close, navigation and mobile
   * backgrounding (including iOS Safari, where `beforeunload` is unreliable); hiding covers the
   * app-switch that never unloads at all; the cleanup covers leaving the route.
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", onHidden);
      persist();
    };
  }, [persist]);

  /** Looked for once per sermon: an offer must not change under someone who is reading it. */
  const [found, setFound] = useState<Record<string, string> | null>(null);
  const inspectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || !sermonId) return;
    const address = `${uid}:${sermonId}`;
    if (inspectedRef.current === address) return;
    inspectedRef.current = address;
    const stored = readStoredCells(uid, sermonId);
    setFound(Object.keys(stored).length > 0 ? stored : null);
  }, [sermonId, uid]);

  /**
   * ONLY CELLS THAT STILL HAVE A CARD TO LIVE IN.
   *
   * A point deleted on another device leaves a draft nothing can display: restoring it puts text
   * into state that no card renders, and the next departure writes that orphan to the server
   * where no screen will ever show it again. Such a cell is not offered — and, deliberately, not
   * deleted either: it is still the last copy of something, and destroying it to tidy up would
   * be the loss this module exists to prevent (BUGS.md carries the note that nothing surfaces it
   * yet).
   */
  const offer = useMemo(() => {
    if (!found) return null;
    const shown = Object.fromEntries(
      Object.entries(found).filter(([nodeId]) => liveNodeIds.has(nodeId))
    );
    return Object.keys(shown).length > 0 ? shown : null;
  }, [found, liveNodeIds]);

  const offerRef = useRef(offer);
  offerRef.current = offer;

  const accept = useCallback(() => setFound(null), []);

  const discard = useCallback(() => {
    const { uid: owner, sermonId: docId } = addressRef.current;
    const rejected = offerRef.current;
    setFound(null);
    if (!owner || !docId || !rejected) return;
    // Exactly what was on screen, compared before deleting: a cell someone has typed into since
    // the offer appeared belongs to them now, not to this dismissal.
    Object.entries(rejected).forEach(([nodeId, text]) => {
      clearDraftIfMatches(cellKey(owner, docId, nodeId), text);
    });
  }, []);

  return useMemo(() => ({ recovered: offer, accept, discard }), [accept, discard, offer]);
}
