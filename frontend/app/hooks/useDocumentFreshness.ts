'use client';


import { doc, getDocFromServer, onSnapshot, waitForPendingWrites, type DocumentData } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientDb } from '@/config/firebaseClientDb';
import { isCollectionOnEngine } from '@/data-engine/clientPolicy';
import { readSermonFromServer } from '@/services/sermonReadFallback.client';
import { diagnosticErrorCode, recordDiagnostic } from '@/utils/appDiagnostics';
import { isBrowserOffline } from '@/utils/connectivity';
import { serializeContent } from '@/utils/contentFingerprint';

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
  /**
   * A failure a returning connection will NOT resolve — access revoked, the account no
   * longer proven, the watch terminated. Kept outside `incident.events`, which is a ring
   * buffer that drops its oldest entries: three presses of "check again" while offline
   * append six events and would push an access denial out of the window, taking the
   * warning — and the retry button with it — off the screen.
   */
  persistentFailure: FreshnessReason | null;
}

/**
 * The structured code of a refusal, or nothing.
 *
 * Bounded on purpose: an error MESSAGE can carry document text, and diagnostics
 * are stored on the device. Only a short, lower-case code survives this.
 */
function refusalCode(error: unknown): string | undefined {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code.replace(/^firestore\//, '') : undefined;
  return code && /^[a-z-]{1,40}$/.test(code) ? code : undefined;
}

const emptyDiagnostics = (): FreshnessDiagnostics => ({
  lastServerResponseAt: null, lastServerResult: null, incident: null, persistentFailure: null,
});

/** Reasons that outlive the connection: reconnecting does not make them go away. */
const PERSISTENT_FAILURES: ReadonlySet<FreshnessReason> = new Set<FreshnessReason>([
  'accessDenied', 'accountRequired', 'listenerStopped',
]);


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
  /** Independent authenticated read for devices whose Firestore listener cannot connect. */
  readFromServer?: (id: string) => Promise<DocumentData | null>;
  /** Visible-only checks while the independent transport is in use. */
  pollIntervalMs?: number;
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
  enabled: requestedEnabled,
  adoptFirstServerAnswerAsKnown = false,
  readFromServer,
  pollIntervalMs,
}: UseDocumentFreshnessOptions<T>): UseDocumentFreshnessResult<T> {
  /**
   * A collection the engine owns has the engine's own freshness (its document observer and
   * DataSyncStatus). This legacy observer would watch a copy the screen no longer renders and,
   * with its read disabled, report "unknown" for ever — so it stays silent there.
   */
  const ownedByEngine = isCollectionOnEngine(collection);
  const enabled = requestedEnabled && !ownedByEngine;
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
  const serialisedKnown = known === null || known === undefined ? null : serializeContent(known);
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

  const hasIndependentRead = Boolean(readFromServer);
  const serverReadRef = useRef(readFromServer);
  serverReadRef.current = readFromServer;
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
      setDiagnostics((current) => (
        current.lastServerResult === 'different' ? { ...current, lastServerResult: 'matching' } : current
      ));
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
    /** At most one refusal per subscription may be deferred — see below. */
    let deferredForOwnWrite = false;
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
          // Remembered outside the bounded history, which drops its oldest entries.
          persistentFailure: PERSISTENT_FAILURES.has(event.reason) ? event.reason : current.persistentFailure,
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
      const errorCode = refusalCode(error);
      const observed = errorCode === 'permission-denied' ? 'accessDenied'
        : errorCode === 'unauthenticated' ? 'accountRequired' : reason;
      recordDiagnostic(reason === 'checkTimeout' ? 'freshness-timeout' : 'freshness-error', { collection, source, code: errorCode, result: observed });
      record({ reason: observed, source, at: Date.now(), ...(errorCode ? { errorCode } : {}) });
      lastRemoteSerialisedRef.current = null;
      setEverAnswered(true);
      setState('unknown');
    };
    /**
     * A REFUSAL ABOUT A DOCUMENT WHOSE OWN WRITE IS STILL UNACKNOWLEDGED SAYS
     * "NOT THERE YET", NOT "NOT YOURS".
     *
     * Rules answer a MISSING document exactly as they answer someone else's:
     * `resource` is null, so `ownsExisting` is false and the read comes back
     * `permission-denied` (`firestore.rules`, `match /studyNotes/{id}`). Measured
     * live: a REST read of a non-existent own document answers 403 while the same
     * token reads an existing one with 200.
     *
     * That matters because a screen may hold a document the server has never seen.
     * The note editor mints a client id and moves the address bar to it the moment
     * the create is SUBMITTED, not when it is accepted — so this listener attaches
     * while the create is still in flight, and whichever of the two streams the
     * backend serves first decides what the person sees. Firestore never resumes a
     * terminally failed listener, so losing that coin flip left "the server refused
     * the check" standing on screen for the rest of the session, seconds after the
     * note had in fact been saved.
     *
     * THE UNACKNOWLEDGED WRITE IS ALSO THE CURE, because it always settles. The
     * backend accepts it and the resubscription succeeds; or it rejects it, the
     * queue empties, and the next refusal arrives with nothing pending behind it
     * and is reported honestly. Hence one deferral per subscription: a second
     * denial, after the writes have settled, is the real answer and must be shown.
     *
     * Offline this promise simply never settles, which is correct — the device is
     * not being told anything — and the `offline` listener already says so.
     */
    const deferUntilOwnWriteSettles = (source: FreshnessEvent['source'], error: unknown): boolean => {
      if (!hasPendingWrites || deferredForOwnWrite) return false;
      if (refusalCode(error) !== 'permission-denied') return false;
      deferredForOwnWrite = true;
      recordDiagnostic('freshness-deferred', { collection, source });
      waitForPendingWrites(getClientDb()).then(() => {
        if (!active) return;
        unsubscribe();
        subscribe();
      }, () => {
        // The wait itself was abandoned (the signed-in user changed). That is a
        // real "cannot tell", not a document that is merely still travelling.
        if (active) unavailable('listenerStopped', source, error);
      });
      return true;
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
        setDiagnostics({ lastServerResponseAt: at, lastServerResult: 'deleted', incident: null, persistentFailure: null });
        return;
      }
      const value = selectRef.current(snapshot.data()!);
      const serialised = serializeContent(value);
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
        // The server answered, so nothing is blocking us any more.
        persistentFailure: null,
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
        if (deferUntilOwnWriteSettles('listener', error)) return;
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
    if (isBrowserOffline()) unavailable('offline', 'device');

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
      const readBaseline = baseline();
      const independentRead = serverReadRef.current ?? (collection === 'sermons' ? readSermonFromServer : undefined);
      const read = independentRead
        ? independentRead(docId).then(data => ({
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
        // An answer started before our own confirmed save cannot judge that newer baseline.
        if (independentRead && readBaseline !== baseline()) return;
        // Server-source reads can still contain latency-compensated local writes.
        if (snapshot.metadata?.hasPendingWrites || hasPendingWrites) unavailable('pendingChanges', source);
        else if (snapshot.metadata?.fromCache) unavailable('cached', source);
        else serverAnswer(snapshot);
      }).catch((error: unknown) => {
        if (!active || requestId !== id) {
          recordDiagnostic('freshness-late-error', { collection, source, code: diagnosticErrorCode(error), elapsedMs: Date.now() - startedAt });
          return;
        }
        // A one-shot read is refused for the same reason a listener is: the
        // document this device is still creating is not on the server yet.
        if (deferUntilOwnWriteSettles(source, error)) return;
        unavailable('checkFailed', source, error);
      }).finally(finish);
      return pending;
    };
    checkRef.current = () => checkServer('manual');
    const recoveryTimer = window.setTimeout(() => {
      if ((serverReadRef.current || collection === 'sermons') && !lastServerProofRef.current && !isBrowserOffline()) {
        void checkServer('opening');
      }
    }, 4000);
    const pollTimer = hasIndependentRead && pollIntervalMs ? window.setInterval(() => {
      if (document.visibilityState === 'visible' && !isBrowserOffline()) void checkServer('return');
    }, Math.max(5000, pollIntervalMs)) : undefined;
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
      window.clearInterval(pollTimer);
      window.removeEventListener('offline', onWentOffline);
      window.removeEventListener('online', onReturned);
      document.removeEventListener('visibilitychange', onReturned);
      window.removeEventListener('focus', onReturned);
      unsubscribe();
    };
  }, [collection, docId, uid, enabled, pollIntervalMs, hasIndependentRead]);

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
    if (current === null || serializeContent(current) !== serializeContent(value)) return;
    // The adopted baseline MOVES with what the screen took, or the very next
    // snapshot would report the value just adopted as newer, forever.
    if (adoptedKnownRef.current !== null) adoptedKnownRef.current = serializeContent(value);
    setRemote(null);
    setState((currentState) => (currentState === 'stale' ? 'fresh' : currentState));
    /**
     * The RECORD of the difference has to settle too, not just the state. It used to
     * survive here until the next server snapshot rewrote it — and offline there is no
     * next snapshot, so a difference the person had already adopted kept the panel on
     * screen, telling them about a conflict they resolved minutes ago.
     */
    setDiagnostics((current) => (
      current.lastServerResult === 'different' ? { ...current, lastServerResult: 'matching' } : current
    ));
  }, []);

  if (ownedByEngine) {
    return { state: 'fresh', remote: null, remotelyDeleted: false, markSynced, diagnostics, checking: false, canCheck: false, checkAgain };
  }

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
      !isBrowserOffline()
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
