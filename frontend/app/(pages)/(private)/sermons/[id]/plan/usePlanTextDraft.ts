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
  /** Last-copy drafts of cells whose node is gone — shown, never offered back. */
  orphaned: { id: string; text: string }[];
  /** Remove the stored copies of cells the person let go after seeing them (compare-before-delete). */
  forget: (cells: Record<string, string>) => void;
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
  pendingText = {},
  liveNodeIds,
  frozen = false,
}: {
  uid: string | null | undefined;
  sermonId: string | null | undefined;
  contentByNodeId: Record<string, string>;
  modifiedNodeIds: Record<string, boolean>;
  /** Cells whose write is queued offline — unconfirmed, however clean the screen looks. */
  pendingNodeIds: Set<string>;
  /** Their queued words (`pendingPlanText`): the draft keeps these, not what the screen shows. */
  pendingText?: Record<string, string>;
  /** Nodes the outline still has. A draft for anything else has nowhere to be shown. */
  liveNodeIds: Set<string>;
  /**
   * This screen is the one shown on a copy for reading (device storage silent), where a separate
   * reader used to stand: it stores and retires nothing, as that reader did. Its cells hold the
   * server's words, and a write still queued makes them look unconfirmed — storing them would lay
   * the copy over newer unsent text. Stored drafts are still read.
   */
  frozen?: boolean;
}): PlanTextDraft {
  const enabled = Boolean(uid && sermonId) && !frozen;

  /**
   * Cells whose current words were typed on this screen — the only ones it may lay over a draft it
   * did not write. A cell joins when typed into and stays while its edit is open or its save is
   * queued (a save queued before the debounce clears the edit mark); it leaves once that edit has
   * settled, so this screen never reaches later over words another tab has stored since.
   */
  const typedHereRef = useRef<Set<string>>(new Set());
  const typedForRef = useRef(`${uid}:${sermonId}`);
  if (typedForRef.current !== `${uid}:${sermonId}`) {
    typedForRef.current = `${uid}:${sermonId}`;
    typedHereRef.current = new Set();
  }
  Object.entries(modifiedNodeIds).forEach(([nodeId, isDirty]) => {
    if (isDirty) typedHereRef.current.add(nodeId);
  });
  typedHereRef.current.forEach((nodeId) => {
    if (!modifiedNodeIds[nodeId] && !pendingNodeIds.has(nodeId)) typedHereRef.current.delete(nodeId);
  });

  /**
   * UNCONFIRMED MEANS TWO THINGS, and both belong here: being typed right now, and sitting in
   * the offline queue — which is precisely "written, but no server has seen it". The second is
   * the one that used to be missed, and missing it is how the words written on a train stopped
   * existing anywhere the person could look.
   */
  const unconfirmed = useMemo(() => {
    const cells: Record<string, string> = {};
    /**
     * A queued cell this screen did not type into keeps its QUEUED words, not the screen's: the
     * screen may hold a copy's words or a document's older ones, and storing those laid them over
     * the person's unsent text (BUG-20261003-preaching-on-copy-stores-copy-words-as-draft). Typing
     * wins below.
     */
    pendingNodeIds.forEach((nodeId) => {
      // Only a cell with a card: a gone node's text is shown as an orphan and is the person's to let go.
      if (!liveNodeIds.has(nodeId) && !(nodeId in contentByNodeId)) return;
      // A cell typed here stores what was typed here — the newest queue entry may be another tab's.
      if (typedHereRef.current.has(nodeId) && nodeId in contentByNodeId) cells[nodeId] = contentByNodeId[nodeId];
      else if (nodeId in pendingText) cells[nodeId] = pendingText[nodeId];
      else if (nodeId in contentByNodeId) cells[nodeId] = contentByNodeId[nodeId];
    });
    Object.entries(modifiedNodeIds).forEach(([nodeId, isDirty]) => {
      if (isDirty) cells[nodeId] = contentByNodeId[nodeId] ?? "";
    });
    return cells;
  }, [contentByNodeId, liveNodeIds, modifiedNodeIds, pendingNodeIds, pendingText]);

  /** What THIS screen last stored per cell, so it can retire its own writes and no one else's. */
  const oursRef = useRef<Record<string, string>>({});
  /** Cells whose copy the browser refused, with the text that was refused. */
  const owedRef = useRef<Record<string, string>>({});
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
      const key = cellKey(owner, docId, nodeId);
      /**
       * A DRAFT THIS SCREEN DID NOT WRITE IS NOT ITS TO REPLACE until the person types into the cell.
       * It may hold words newer than anything queued — typed after the queue entry, then the page
       * closed — and it stays for the person to restore or let go
       * (BUG-20261003-preaching-on-copy-stores-copy-words-as-draft).
       */
      if (!typedHereRef.current.has(nodeId)) {
        const stored = readDraft<string>(key)?.value;
        if (typeof stored === "string" && stored !== text && stored !== oursRef.current[nodeId]) return;
      }
      // Only a copy that landed is ours; a refused one is tried again on the next pass.
      if (saveDraft(key, text)) {
        oursRef.current[nodeId] = text;
        delete owedRef.current[nodeId];
      } else {
        owedRef.current[nodeId] = text;
      }
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
    // A cell confirmed while its copy was refused: the copy it was owed is no longer needed.
    Object.keys(owedRef.current).forEach((nodeId) => {
      if (nodeId in cells) return;
      clearDraftIfMatches(cellKey(owner, docId, nodeId), owedRef.current[nodeId]);
      delete owedRef.current[nodeId];
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

  /** Last-copy drafts of cells whose node is gone: never offered back, shown instead (OrphanedPlanText). */
  const orphaned = useMemo(() => Object.entries(found ?? {})
    .filter(([nodeId, text]) => !liveNodeIds.has(nodeId) && text.trim() !== "")
    .map(([id, text]) => ({ id, text })), [found, liveNodeIds]);
  const liveNodeIdsRef = useRef(liveNodeIds);
  liveNodeIdsRef.current = liveNodeIds;

  /** Settling the offer settles only what was offered; drafts of gone nodes stay to be shown. */
  const keepOnlyOrphaned = useCallback(() => setFound((previous) => {
    const rest = Object.fromEntries(Object.entries(previous ?? {}).filter(([nodeId]) => !liveNodeIdsRef.current.has(nodeId)));
    return Object.keys(rest).length ? rest : null;
  }), []);
  const accept = keepOnlyOrphaned;

  const discard = useCallback(() => {
    const { uid: owner, sermonId: docId } = addressRef.current;
    const rejected = offerRef.current;
    keepOnlyOrphaned();
    if (!owner || !docId || !rejected) return;
    // Exactly what was on screen, compared before deleting: a cell someone has typed into since
    // the offer appeared belongs to them now, not to this dismissal.
    Object.entries(rejected).forEach(([nodeId, text]) => {
      clearDraftIfMatches(cellKey(owner, docId, nodeId), text);
    });
  }, [keepOnlyOrphaned]);

  /**
   * The person let these cells go after seeing them. Only the copy they saw, or the one this screen
   * stored, is removed — a newer text another tab has put under the key since stays, and so does an
   * older draft found at open that the screen showed this session's text in place of
   * (BUG-20260928-orphan-forget-drops-unseen-older-draft): it was not what the person let go, so it
   * comes back as a gone point's text the next time the plan opens, for them to decide.
   */
  const forget = useCallback((cells: Record<string, string>) => {
    const { uid: owner, sermonId: docId } = addressRef.current;
    if (!owner || !docId) return;
    Object.entries(cells).forEach(([nodeId, text]) => {
      const key = cellKey(owner, docId, nodeId);
      new Set([text, oursRef.current[nodeId]]).forEach((seen) => {
        if (seen !== undefined) clearDraftIfMatches(key, seen);
      });
      delete oursRef.current[nodeId];
    });
    setFound((previous) => previous && Object.fromEntries(Object.entries(previous).filter(([nodeId]) => !(nodeId in cells))));
  }, []);

  return useMemo(() => ({ recovered: offer, accept, discard, orphaned, forget }), [accept, discard, offer, orphaned, forget]);
}
