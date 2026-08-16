"use client";

import { useCallback, useMemo, useRef } from "react";

import type { Sermon } from "@/models/models";

/**
 * WHAT THE SERVER HELD WHEN THIS SCREEN TOOK EACH CELL.
 *
 * The guard in `conflictSafeUpdate` refuses a save whose fields no longer look the way its
 * author found them. That question only has an answer if somebody remembers the finding —
 * and the two plan editors are the only ones who can, because only they know when a cell was
 * adopted from storage and when it was last confirmed written.
 *
 * It lives here, in one place, because both screens need exactly the same bookkeeping and a
 * second copy of a rule like this drifts: one screen would keep vouching for text it had
 * already overwritten, and the guard would hand it permission to do it again.
 *
 * ⚠️ THE BASELINE IS THE STORED VALUE, NOT THE DISPLAYED ONE. Until a sermon's first save
 * under the new shape its text lives in the legacy per-section cells, which `planText` has
 * never contained; `readPlanText` merges the two so the screen can show something. Vouching
 * for that merged value would compare it against an absent key and refuse every first save
 * on an old sermon.
 */
export interface PlanTextBaseline {
  /**
   * Storage has spoken. Cells the screen ADOPTED get its value as their new baseline; a cell
   * being typed into keeps the one it was opened with — that is what the eventual save is
   * judged against, and moving it would silently license overwriting the other device.
   */
  adopt: (sermon: Sermon | null | undefined, isModified: (nodeId: string) => boolean) => void;
  /** The server accepted exactly this text, so this is what it now holds. */
  confirm: (sent: Record<string, string>) => void;
  /**
   * A REFUSAL TOLD US WHAT IS REALLY THERE — take it, even for a cell being typed into.
   *
   * This is the one case where a dirty cell's baseline MUST move. Left at the value the screen
   * opened with, the very next press recreates the same conflict, and the one after that, for
   * ever: the person is trapped with text they cannot save and no way out but copying it
   * somewhere and reloading. With the truth adopted, a second deliberate press means "mine
   * wins" — a decision the person makes, having been told, instead of a wall.
   */
  observe: (serverByNodeId: Record<string, string | null>) => void;
  /** These nodes are gone; remembering what they held only invites a false comparison. */
  forget: (nodeIds: string[]) => void;
  /** The baseline to state for a write covering these nodes. */
  forNodes: (nodeIds: string[]) => Record<string, string | null>;
}

export function usePlanTextBaseline(sermonId: string | null | undefined): PlanTextBaseline {
  const baselineRef = useRef<Record<string, string | null>>({});
  /**
   * Whose baseline this is. Kept beside the values rather than reset by an effect: an effect
   * runs after the render that already handed the new sermon to the screen, so a save fired
   * in between would have been judged against the PREVIOUS sermon's text.
   */
  const ownerRef = useRef<string | null | undefined>(sermonId);
  if (ownerRef.current !== sermonId) {
    ownerRef.current = sermonId;
    baselineRef.current = {};
  }

  const adopt = useCallback((
    sermon: Sermon | null | undefined,
    isModified: (nodeId: string) => boolean
  ) => {
    const stored = sermon?.planText ?? {};
    Object.keys(stored).forEach((nodeId) => {
      if (isModified(nodeId)) return;
      baselineRef.current[nodeId] = stored[nodeId] ?? null;
    });
  }, []);

  const confirm = useCallback((sent: Record<string, string>) => {
    Object.entries(sent).forEach(([nodeId, text]) => {
      baselineRef.current[nodeId] = text;
    });
  }, []);

  const observe = useCallback((serverByNodeId: Record<string, string | null>) => {
    Object.entries(serverByNodeId).forEach(([nodeId, text]) => {
      baselineRef.current[nodeId] = text;
    });
  }, []);

  const forget = useCallback((nodeIds: string[]) => {
    nodeIds.forEach((nodeId) => {
      delete baselineRef.current[nodeId];
    });
  }, []);

  /**
   * A node nobody has a value for is stated as `null` rather than left out. Omitting it would
   * drop that field from the comparison entirely, so a cell created on another device between
   * opening this screen and pressing Save would be overwritten without a word — the exact case
   * the guard exists for.
   */
  const forNodes = useCallback((nodeIds: string[]): Record<string, string | null> =>
    Object.fromEntries(nodeIds.map((nodeId) => [nodeId, baselineRef.current[nodeId] ?? null])),
  []);

  /**
   * ONE OBJECT FOR THE LIFE OF THE SCREEN. Both editors call `adopt` from an effect that
   * lists this among its dependencies, and a fresh object literal per render made that effect
   * run on every render — it sets state, which renders, which runs it again. The screens died
   * of an exhausted heap before anything reached storage.
   */
  return useMemo(
    () => ({ adopt, confirm, observe, forget, forNodes }),
    [adopt, confirm, observe, forget, forNodes]
  );
}
