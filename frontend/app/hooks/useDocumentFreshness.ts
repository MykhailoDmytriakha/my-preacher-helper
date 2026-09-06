'use client';

import { doc, getDocFromServer, onSnapshot, type DocumentData } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientDb } from '@/config/firebaseClientDb';
import { readSermonFromServer } from '@/services/sermonReadFallback.client';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';

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

export type FreshnessReason =
  | 'initialCheck' | 'cached' | 'offline' | 'listenerStopped'
  | 'accessDenied' | 'accountRequired' | 'checkFailed' | 'checkTimeout' | 'checking' | 'pendingChanges';

export interface FreshnessEvent {
  reason: FreshnessReason;
  at: number;
  source: 'opening' | 'listener' | 'device' | 'return' | 'manual';
  /** Only a structured error code, never document content or raw error messages. */
  errorCode?: string;
}

export interface FreshnessDiagnostics {
  lastServerResponseAt: number | null;
  lastServerResult: 'matching' | 'different' | 'deleted' | 'uncompared' | null;
  incident: { origin: FreshnessEvent; events: FreshnessEvent[] } | null;
}

const emptyDiagnostics = (): FreshnessDiagnostics => ({
  lastServerResponseAt: null, lastServerResult: null, incident: null,
});


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
  diagnostics: FreshnessDiagnostics;
  checking: boolean;
  canCheck: boolean;
  /** Read-only verification: never replaces the editor or writes a document. */
  checkAgain: () => Promise<void>;
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
   * Set when the SERVER speaks — a server-backed snapshot or a terminal listener
   * error, which is a genuine "I cannot tell" and must be shown. NOT set by the
   * cache-only emission Firestore serves from IndexedDB before every first server
   * answer: that one is the silence of a page that has only just opened, and
   * treating it as an answer made the amber pill flash on every reload.
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
  const [diagnostics, setDiagnostics] = useState<FreshnessDiagnostics>(emptyDiagnostics);
  const [checking, setChecking] = useState(false);
  const checkRef = useRef<(() => Promise<void>) | null>(null);
  const checkAgain = useCallback(() => checkRef.current?.() ?? Promise.resolve(), []);

  // Serialised value the editor already accounts for. Kept in a ref so a new
  // keystroke never re-subscribes the listener.
  const knownRef = useRef<string | null>(null);
  const serialisedKnown = known === null || known === undefined ? null : JSON.stringify(known);
  knownRef.current = serialisedKnown;

  /**
   * What the server last said, in the very shape the comparison uses.
   *
   * Freshness is a relation between TWO values, not an event on one of them. The
   * comparison used to live only inside the snapshot handler: a snapshot arrived,
   * it was compared once. When the screen later caught up — the editor's own write
   * coming back with its response — nobody re-compared, and the warning stayed up
   * until the document happened to change again.
   */
  const lastRemoteSerialisedRef = useRef<string | null>(null);

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

  /**
   * THE SCREEN CAUGHT UP — THE WARNING CLEARS WITHOUT WAITING FOR A NEW SNAPSHOT.
   *
   * The editor's own write travels to the server and comes back as a response.
   * Between those two moments the server already holds the new value while the
   * screen still holds the old one, and the snapshot honestly reports a mismatch.
   * The screen then catches up and the mismatch is gone — but nobody re-compared,
   * so the warning stayed up until the document happened to change again.
   *
   * This recheck can only CLEAR. Only the server may raise the warning: otherwise
   * a person who is merely typing would announce a "remote edit" to himself.
   */
  useEffect(() => {
    const base = baseline();
    const lastRemote = lastRemoteSerialisedRef.current;
    if (base === null || lastRemote === null) return;
    if (lastRemote === base) {
      setState('fresh');
      setRemote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialisedKnown]);

  useEffect(() => {
    setState('unknown');
    setEverAnswered(false);
    setRemote(null);
    setRemotelyDeleted(false);
    setSilenceIsNews(false);
    setDiagnostics(emptyDiagnostics());
    setChecking(false);
    lastServerProofRef.current = 0;
    lastRemoteSerialisedRef.current = null;
    adoptedKnownRef.current = null;
    checkRef.current = null;
    if (!enabled || !docId || !uid) return;

    let active = true;
    let listenerStopped = false;
    let hasPendingWrites = false;
    let unsubscribe = () => {};
    let requestId = 0;
    let inFlight: Promise<void> | null = null;
    let finishRead: (() => void) | null = null;
    const ref = doc(getClientDb(), collection, docId);
    recordDiagnostic('freshness-start', { collection });

    const record = (event: FreshnessEvent, onlyExisting = false) => {
      setDiagnostics((current) => {
        if (onlyExisting && !current.incident) return current;
        const previous = current.incident?.events.at(-1);
        // Repeated metadata notifications are not new incidents. Manual attempts are.
        if (previous?.reason === event.reason && previous.source === event.source &&
            previous.errorCode === event.errorCode && event.source !== 'manual') return current;
        return {
          ...current,
          incident: {
            origin: current.incident?.origin ?? event,
            // The origin is retained separately even when the bounded history rolls over.
            events: [...(current.incident?.events ?? []).slice(-5), event],
          },
        };
      });
    };
    const unavailable = (reason: FreshnessReason, source: FreshnessEvent['source'], error?: unknown) => {
      if (!active) return;
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
        ? error.code.replace(/^firestore\//, '') : undefined;
      const errorCode = code && /^[a-z-]{1,40}$/.test(code) ? code : undefined;
      const observed = errorCode === 'permission-denied' ? 'accessDenied'
        : errorCode === 'unauthenticated' ? 'accountRequired' : reason;
      recordDiagnostic(reason === 'checkTimeout' ? 'freshness-timeout' : 'freshness-error', { collection, source, code: errorCode, result: observed });
      record({ reason: observed, source, at: Date.now(), ...(errorCode ? { errorCode } : {}) });
      lastRemoteSerialisedRef.current = null;
      setEverAnswered(true);
      setState('unknown');
    };
    const serverAnswer = (snapshot: { exists: () => boolean; data: () => DocumentData | undefined }) => {
      if (!active) return;
      // A newer server snapshot supersedes any older outstanding one-shot read.
      requestId += 1;
      finishRead?.();
      const at = Date.now();
      lastServerProofRef.current = at;
      setEverAnswered(true);
      const exists = snapshot.exists();
      setRemotelyDeleted(!exists);
      if (!exists) {
        recordDiagnostic('snapshot-server', { collection, result: 'deleted' });
        lastRemoteSerialisedRef.current = null;
        setRemote(null);
        setState('stale');
        setDiagnostics({ lastServerResponseAt: at, lastServerResult: 'deleted', incident: null });
        return;
      }
      const value = selectRef.current(snapshot.data()!);
      const serialised = JSON.stringify(value);
      const base = baseline();
      if (base === null && adoptRef.current) adoptedKnownRef.current = serialised;
      const different = base !== null && serialised !== base;
      recordDiagnostic('snapshot-server', { collection, result: base === null ? 'uncompared' : different ? 'different' : 'matching' });
      lastRemoteSerialisedRef.current = different ? serialised : null;
      setRemote(different ? value : null);
      setState(different ? 'stale' : 'fresh');
      setDiagnostics({
        lastServerResponseAt: at,
        lastServerResult: base === null ? 'uncompared' : different ? 'different' : 'matching',
        incident: null,
      });
    };
    const subscribe = () => {
      listenerStopped = false;
      unsubscribe = onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
        if (!active) return;
        hasPendingWrites = snapshot.metadata.hasPendingWrites;
        if (snapshot.metadata.hasPendingWrites) {
          recordDiagnostic('snapshot-pending', { collection });
          return;
        }
        if (snapshot.metadata.fromCache) {
          recordDiagnostic('snapshot-cache', { collection });
          lastRemoteSerialisedRef.current = null;
          setState('unknown');
          // Cache-first startup is routine. Do not raise an incident until the grace
          // period expires or a previously confirmed session becomes unconfirmed.
          if (lastServerProofRef.current > 0) unavailable('cached', 'listener');
          return;
        }
        serverAnswer(snapshot);
      }, (error) => {
        listenerStopped = true;
        unavailable('listenerStopped', 'listener', error);
      });
    };
    subscribe();
    const graceTimer = window.setTimeout(() => {
      if (!active || lastServerProofRef.current > 0) return;
      setSilenceIsNews(true);
      // A terminal failure already has a more specific explanation.
      if (!listenerStopped) unavailable('initialCheck', 'opening');
    }, 15_000);
    if (navigator.onLine === false) unavailable('offline', 'device');

    const checkServer = (source: 'manual' | 'return' | 'opening'): Promise<void> => {
      if (!active) return Promise.resolve();
      if (inFlight) return inFlight;
      const id = ++requestId;
      const startedAt = Date.now();
      recordDiagnostic('freshness-check', { collection, source });
      setChecking(true);
      record({ reason: 'checking', source, at: Date.now() }, true);
      let resolveRead!: () => void;
      const pending = new Promise<void>((resolve) => { resolveRead = resolve; });
      inFlight = pending;
      const timer = window.setTimeout(() => {
        if (active && requestId === id) {
          requestId += 1;
          unavailable('checkTimeout', source);
        }
        finish();
      }, 15_000);
      const finish = () => {
        window.clearTimeout(timer);
        if (inFlight === pending) {
          inFlight = null;
          finishRead = null;
          if (active) setChecking(false);
        }
        resolveRead();
      };
      finishRead = finish;
      // Firestore does not resume a terminally failed listener on its own.
      if (listenerStopped) {
        unsubscribe();
        subscribe();
      }
      // A stalled SDK listener and getDocFromServer share a transport. Sermons
      // recover through an independent authenticated read of the same document.
      const read = collection === 'sermons'
        ? readSermonFromServer(docId).then(data => ({
          exists: () => Boolean(data),
          data: () => data as DocumentData | undefined,
          metadata: { fromCache: false, hasPendingWrites: false },
        }))
        : getDocFromServer(ref);
      read.then((snapshot) => {
        if (!active || requestId !== id) {
          recordDiagnostic('freshness-late-response', { collection, source, elapsedMs: Date.now() - startedAt });
          return;
        }
        // Server-source reads can still contain latency-compensated local writes.
        if (snapshot.metadata?.hasPendingWrites || hasPendingWrites) unavailable('pendingChanges', source);
        else if (snapshot.metadata?.fromCache) unavailable('cached', source);
        else serverAnswer(snapshot);
      }).catch((error: unknown) => {
        if (active && requestId === id) unavailable('checkFailed', source, error);
        else recordDiagnostic('freshness-late-error', { collection, source, code: diagnosticErrorCode(error), elapsedMs: Date.now() - startedAt });
      }).finally(finish);
      return pending;
    };
    checkRef.current = () => checkServer('manual');
    const recoveryTimer = window.setTimeout(() => {
      if (collection === 'sermons' && !lastServerProofRef.current && navigator.onLine !== false) {
        void checkServer('opening');
      }
    }, 4000);
    const onWentOffline = () => unavailable('offline', 'device');
    const onReturned = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastServerProofRef.current < STALE_PROOF_MS) return;
      void checkServer('return');
    };
    window.addEventListener('offline', onWentOffline);
    window.addEventListener('online', onReturned);
    document.addEventListener('visibilitychange', onReturned);
    window.addEventListener('focus', onReturned);
    return () => {
      active = false;
      recordDiagnostic('freshness-stop', { collection });
      requestId += 1;
      checkRef.current = null;
      finishRead?.();
      window.clearTimeout(graceTimer);
      window.clearTimeout(recoveryTimer);
      window.removeEventListener('offline', onWentOffline);
      window.removeEventListener('online', onReturned);
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
    diagnostics,
    checking,
    canCheck: Boolean(enabled && docId && uid),
    checkAgain,
  };
}
