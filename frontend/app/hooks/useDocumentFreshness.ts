'use client';

import { doc, getDocFromServer, onSnapshot, type DocumentData } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientDb } from '@/config/firebaseClientDb';

/**
 * Is the document open in this editor still the newest one?
 *
 * WHY A SEPARATE HOOK. The app already tells you when a NEW VERSION OF THE APP
 * ships. It never tells you that THE DOCUMENT YOU ARE LOOKING AT changed on
 * another device — which is the loss the owner actually hit: edit on the phone,
 * open the laptop showing yesterday's copy, save, edit gone.
 *
 * WHAT THIS DOES AND DOES NOT DO.
 * - It only OBSERVES. It never writes, never touches React Query, and never
 *   replaces what the editor is showing. Silently swapping text under someone who
 *   is typing is a worse bug than the one being fixed.
 * - Freshness has THREE states, not two. `unknown` is a real answer: offline,
 *   permission error, or before the first server snapshot arrives. Showing "fresh"
 *   then would be a lie.
 *
 * OWN WRITES MUST NOT RAISE THE FLAG. Firestore delivers a snapshot for this
 * client's own writes too, first with `hasPendingWrites` and again once the
 * server acknowledges. Both are ignored: pending ones by the metadata flag, and
 * acknowledged ones because the caller reports what it saved via `markSynced`.
 */
export type FreshnessState = 'fresh' | 'stale' | 'unknown';

/**
 * How old a server proof may be before a RETURN to the tab re-checks it.
 *
 * Two minutes: long enough that switching tabs while working costs nothing, short
 * enough that "I picked this up again after lunch" always asks.
 */
const STALE_PROOF_MS = 2 * 60 * 1000;

export interface UseDocumentFreshnessOptions<T> {
  /** Firestore collection holding the document. */
  collection: string;
  /** Document id. Null/undefined disables the hook. */
  docId: string | null | undefined;
  /** Owner; null/undefined disables the hook (no listener without a signed-in user). */
  uid: string | null | undefined;
  /** Pulls the fields this editor cares about out of a raw snapshot. */
  select: (data: DocumentData) => T;
  /** What this editor last knew to be on the server; null while still loading. */
  known: T | null;
  /** False keeps the listener detached (editor not ready, feature off). */
  enabled: boolean;
  /**
   * Treat the FIRST server answer as what this screen opened with.
   *
   * For screens that do not hold the document at all. The settings page is the
   * case: its toggles each fetch their own field, so there is no object to pass as
   * `known` — and passing this hook's own `remote` back in is a closed loop, because
   * `remote` is only filled once the state is already `stale`, which cannot happen
   * while `known` is null. Live validation caught exactly that: the pill was dead
   * while its unit test passed, because the test mocked the hook.
   *
   * With this on, the first server-backed snapshot becomes the baseline and every
   * later difference is news. `markSynced` moves the baseline forward, so adopting
   * the newer value goes quiet and a further change is news again.
   */
  adoptFirstServerAnswerAsKnown?: boolean;
}

export interface UseDocumentFreshnessResult<T> {
  state: FreshnessState;
  /** The newer server value, when `state === 'stale'`. Never applied for you. */
  remote: T | null;
  /** The document disappeared on another device. */
  remotelyDeleted: boolean;
  /** Caller confirmed it now holds this value — stop reporting it as newer. */
  markSynced: (value: T) => void;
}

export function useDocumentFreshness<T>({
  collection,
  docId,
  uid,
  select,
  known,
  enabled,
  adoptFirstServerAnswerAsKnown = false,
}: UseDocumentFreshnessOptions<T>): UseDocumentFreshnessResult<T> {
  const [state, setState] = useState<FreshnessState>('unknown');
  /**
   * Has the server ever answered for THIS document in this session?
   *
   * `unknown` is the starting state, so a screen is "unknown" for the moment
   * before the listener says anything — every time any page opens. Warning there
   * would cry wolf on a cold start, and a person who learns to ignore the pill
   * will also ignore the one that matters.
   *
   * Set on ANY listener event, including a cache-only snapshot and a terminal
   * error: those are genuine "I cannot tell", and they must still be shown.
   */
  const [everAnswered, setEverAnswered] = useState(false);
  /**
   * The silence has lasted long enough to be news.
   *
   * Suppressing "unknown" before the first answer keeps a cold start quiet — but
   * adversarial review caught the other side of it: if the connection is down, the
   * listener never answers at all, and the screen then claimed FRESH for an
   * hours-long disconnected session. A page open takes a moment; not hearing back
   * for this long means we genuinely cannot tell, and saying so is the whole point.
   */
  const [silenceIsNews, setSilenceIsNews] = useState(false);
  const [remote, setRemote] = useState<T | null>(null);
  const [remotelyDeleted, setRemotelyDeleted] = useState(false);

  // Serialised value the editor already accounts for. Kept in a ref so a new
  // keystroke never re-subscribes the listener.
  const knownRef = useRef<string | null>(null);
  knownRef.current = known === null || known === undefined ? null : JSON.stringify(known);

  /**
   * The baseline this hook adopted itself, for callers that hold no document.
   *
   * A ref, not state: adopting it must not re-render, and it must not re-subscribe
   * the listener. Cleared whenever the document changes, like every other per-
   * document memory in the effect below.
   */
  const adoptedKnownRef = useRef<string | null>(null);
  const adoptRef = useRef(adoptFirstServerAnswerAsKnown);
  adoptRef.current = adoptFirstServerAnswerAsKnown;
  /** What the screen accounts for: its own value, or the one we adopted for it. */
  const baseline = () => knownRef.current ?? adoptedKnownRef.current;

  const selectRef = useRef(select);
  selectRef.current = select;

  /** When the server last told us anything about THIS document. */
  const lastServerProofRef = useRef(0);

  useEffect(() => {
    if (!enabled || !docId || !uid) {
      setState('unknown');
      setRemote(null);
      setRemotelyDeleted(false);
      return;
    }

    let active = true;
    // A NEW DOCUMENT KNOWS NOTHING YET.
    //
    // Navigating from one document to another re-runs this effect but used to leave
    // `state`, `everAnswered`, `remote` and the last server proof exactly as the
    // PREVIOUS document left them. So document B inherited A's "fresh" — the screen
    // asserted freshness about a document nothing had ever said anything about — and
    // the return-to-tab check was skipped because A's proof looked recent.
    setState('unknown');
    setEverAnswered(false);
    setRemote(null);
    setRemotelyDeleted(false);
    lastServerProofRef.current = 0;
    adoptedKnownRef.current = null;
    setSilenceIsNews(false);
    const graceTimer = window.setTimeout(() => {
      if (active) setSilenceIsNews(true);
    }, 15_000);
    const ref = doc(getClientDb(), collection, docId);

    const unsubscribe = onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (!active) return;

        // Our own write on the way out — not news from anywhere.
        if (snapshot.metadata.hasPendingWrites) return;
        // The listener has spoken — from here on "unknown" is real news, not the
        // silence of a page that has only just opened.
        setEverAnswered(true);
        // A cached emission proves nothing about the server yet.
        if (snapshot.metadata.fromCache) {
          // A cached emission proves nothing about the server RIGHT NOW, even if a
          // server snapshot arrived earlier: the connection may since have dropped.
          // Keeping a stale "fresh" here is the lie this state exists to prevent.
          setState('unknown');
          return;
        }

        if (!snapshot.exists()) {
          setRemotelyDeleted(true);
          setState('stale');
          setRemote(null);
          return;
        }

        // A server-backed snapshot IS the proof; remember when it arrived.
        lastServerProofRef.current = Date.now();
        setRemotelyDeleted(false);
        const value = selectRef.current(snapshot.data());
        const serialised = JSON.stringify(value);

        const base = baseline();
        if (base === null) {
          // Nothing to compare against yet. With adoption on, THIS is what the
          // screen opened with; without it, we simply cannot tell and stay quiet.
          if (adoptRef.current) adoptedKnownRef.current = serialised;
          setState('fresh');
          setRemote(null);
          return;
        }
        if (serialised === base) {
          setState('fresh');
          setRemote(null);
          return;
        }

        setState('stale');
        setRemote(value);
      },
      () => {
        if (!active) return;
        setEverAnswered(true);
        // A listener error is terminal — Firestore sends nothing more. Saying
        // "fresh" here would claim knowledge we no longer have.
        setState('unknown');
        setRemote(null);
      }
    );

    /**
     * WHEN THE SERVER LAST PROVED ANYTHING, and what to do when that gets old.
     *
     * A healthy idle listener is SILENT: with no changes there are no snapshots for
     * hours, so "silence for N minutes" cannot mean staleness on its own — a timer
     * alone would cry wolf all day. But silence is also what a dead connection
     * looks like: the laptop slept, or the wifi turned into a captive portal that
     * accepts packets and routes nothing, and the screen kept saying "fresh" while
     * the phone rewrote the document hours ago.
     *
     * The honest signal is the moment the PERSON comes back to this tab. That is
     * exactly when they continue work started on another device. If the last server
     * proof is older than a couple of minutes, we ask the server directly — one
     * read, only on a real return — and if it cannot answer, we say so.
     */
    const onWentOffline = () => {
      if (active) setState('unknown');
    };
    const onReturned = () => {
      if (!active || document.visibilityState !== 'visible') return;
      if (Date.now() - lastServerProofRef.current < STALE_PROOF_MS) return;
      getDocFromServer(ref)
        .then((snapshot) => {
          if (!active) return;
          lastServerProofRef.current = Date.now();
          setEverAnswered(true);
          if (!snapshot.exists()) {
            setRemotelyDeleted(true);
            setState('stale');
            setRemote(null);
            return;
          }
          const value = selectRef.current(snapshot.data());
          const serialised = JSON.stringify(value);
          const base = baseline();
          if (base === null) {
            if (adoptRef.current) adoptedKnownRef.current = serialised;
            setState('fresh');
            setRemote(null);
            return;
          }
          if (serialised === base) {
            setState('fresh');
            setRemote(null);
            return;
          }
          setState('stale');
          setRemote(value);
        })
        .catch(() => {
          // Could not reach the server on a deliberate ask — that is a real "cannot
          // tell", not silence to be papered over with a comforting "fresh".
          if (active) setState('unknown');
        });
    };

    window.addEventListener('offline', onWentOffline);
    document.addEventListener('visibilitychange', onReturned);
    window.addEventListener('focus', onReturned);

    return () => {
      active = false;
      window.clearTimeout(graceTimer);
      window.removeEventListener('offline', onWentOffline);
      document.removeEventListener('visibilitychange', onReturned);
      window.removeEventListener('focus', onReturned);
      unsubscribe();
    };
  }, [collection, docId, uid, enabled]);

  /**
   * The caller reports what it now shows. ONLY an exact match clears the warning.
   *
   * The earlier version flipped stale→fresh whatever it was handed. That is how a
   * real newer version gets hidden: the person takes the remote text, a THIRD
   * change lands from the other device a moment later, the screen calls
   * `markSynced` with what it took, and the banner about the newer version
   * disappears. Silence then means "confirmed fresh", which is exactly the lie
   * this hook exists to prevent — so anything but an exact match leaves the
   * warning standing.
   */
  const remoteRef = useRef<T | null>(null);
  remoteRef.current = remote;
  const markSynced = useCallback((value: T) => {
    const current = remoteRef.current;
    if (current === null || JSON.stringify(current) !== JSON.stringify(value)) return;
    // The adopted baseline MOVES with what the screen took, or the very next
    // snapshot would report the value just adopted as newer, forever.
    if (adoptedKnownRef.current !== null) adoptedKnownRef.current = JSON.stringify(value);
    setRemote(null);
    setState((currentState) => (currentState === 'stale' ? 'fresh' : currentState));
  }, []);

  return {
    // Before the first answer we say nothing rather than "unknown": a cold start
    // is not a warning, and a pill that appears on every page open is noise the
    // person will learn to skip.
    // Quiet for the moment after opening; honest once the silence is long enough
    // to mean something, or when the browser itself says there is no connection.
    state:
      state === 'unknown' &&
      !everAnswered &&
      !silenceIsNews &&
      !(typeof navigator !== 'undefined' && navigator.onLine === false)
        ? 'fresh'
        : state,
    remote,
    remotelyDeleted,
    markSynced,
  };
}
