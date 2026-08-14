import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { isOfflineQueuedError } from '@/services/conflictSafeUpdate.client';
import {
  showRecoverableWriteFailure,
  subscribeToTerminalMutationFailures,
  writeFailureTranslationKey,
} from '@/utils/writeRecovery';

import type { QueryClient } from '@tanstack/react-query';

/**
 * When this browser session started. Failed mutations are PERSISTED, so anything with an
 * older stamp was submitted in a previous session — and was already reported there.
 */
const SESSION_STARTED_AT = Date.now();

/**
 * ONE WAY TO WRITE — read `docs/recoverable-writes.md` before adding an entity or a
 * write operation. Copying a neighbouring hook is how the defect this prevents came
 * back four times: a write that has merely STARTED is indistinguishable from one that
 * was ACCEPTED, so editors closed and erased what a person had just written.
 */
export type WriteAcceptance =
  | { kind: 'persisted' }
  | { kind: 'queued'; receipt: string }
  // `reason` is part of the outcome because the two cases are not the same promise to
  // the person: one says "your text is already inside another write", the other says
  // "nothing was written and nothing will be until you answer a question".
  | { kind: 'skipped'; reason: 'in-flight' | 'awaiting-confirmation' };

export interface WriteSubmission {
  /**
   * Resolves when it is SAFE for the editor to close, and says WHY it is safe.
   * Rejects when the write was refused before anything took ownership of it.
   */
  acceptance: Promise<WriteAcceptance>;
  /**
   * The eventual persistence result. For a queued write this settles much later
   * (on replay); for a persisted one it settles together with `acceptance`.
   */
  persistence: Promise<void>;
}

/**
 * A write whose promise settles only when the SERVER has it. This is the honest
 * wrapper for `mutateAsync` and for awaited service calls.
 */
export function persistedWrite(request: Promise<unknown>): WriteSubmission {
  const persistence = request.then(() => undefined);
  const acceptance = persistence.then(
    (): WriteAcceptance => ({ kind: 'persisted' }),
    (error): WriteAcceptance => {
      /**
       * "QUEUED" IS AN ACCEPTANCE, EVEN ON A PATH THAT EXPECTED THE SERVER.
       *
       * The caller picks this wrapper when `navigator.onLine` says yes — but the browser
       * can be nominally online with Firestore unreachable. `conflictSafeUpdate` stores
       * the intent in the durable outbox and throws `OfflineQueuedError`, which is a
       * RECEIPT, not a refusal. Treating it as one made the app roll the optimistic text
       * back and show a failure for an edit it had safely stored — and invited a retry
       * that would enqueue the same change twice.
       */
      if (isOfflineQueuedError(error)) {
        return { kind: 'queued', receipt: `outbox:${error.aggregate}` };
      }
      throw error;
    }
  );
  // BOTH promises get a defensive observer, not just `persistence`. `acceptance` is
  // derived from it, so a refusal nobody reads surfaced as an unhandled rejection —
  // caught by this module's own test before any caller existed.
  void persistence.catch(() => undefined);
  void acceptance.catch(() => undefined);
  return { acceptance, persistence };
}

/**
 * A write a durable queue has taken ownership of. `receipt` identifies the stored
 * intent, so a UI that wants to show "waiting to sync" can point at something real
 * instead of guessing.
 */
export function queuedWrite(receipt: string, request: Promise<unknown>): WriteSubmission {
  const persistence = request.then(() => undefined);
  void persistence.catch(() => undefined);

  /**
   * A write that ALREADY failed was never queued.
   *
   * Resolving acceptance immediately looked harmless — the queue takes ownership at
   * once, after all. But when the request is already rejected, immediate resolution
   * wins the microtask race against the rejection, and the editor closes over a write
   * nothing ever accepted. Adversarial review reproduced exactly that.
   *
   * So acceptance yields to the macrotask queue first: a rejection that is already
   * pending settles within it and rejects acceptance, while a genuinely queued write
   * (nothing to report yet) resolves as `queued` on the next tick. The delay is a
   * single tick, invisible to the person and paid only once per write.
   */
  const acceptance = new Promise<WriteAcceptance>((resolve, reject) => {
    let settled = false;
    // ONLY a rejection may overtake acceptance. A fast SUCCESS stays `queued`: the
    // queue is what took the write, and re-labelling it would be a different claim.
    persistence.catch((error) => {
      if (settled) return;
      // An OfflineQueuedError is not a refusal — it is the outbox saying "I have it".
      // Rejecting on it would turn successful offline queueing into a failure and
      // break the mirror rule the whole contract is built around.
      if (isOfflineQueuedError(error)) {
        settled = true;
        resolve({ kind: 'queued', receipt });
        return;
      }
      settled = true;
      reject(error);
    });
    // One macrotask, deliberately. Microtasks are not enough: a refusal that travels
    // through an async wrapper (try/catch + rethrow) settles several microtasks later,
    // and acceptance would still win the race — the very defect this guards against.
    // A macrotask covers any such chain within the current tick. The cost is one
    // invisible tick before the editor closes; the benefit is that it never closes
    // over a write that has already been refused.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'queued', receipt });
    }, 0);
  });
  void acceptance.catch(() => undefined);

  return { acceptance, persistence };
}

/**
 * NOTHING WAS WRITTEN AND NOTHING WILL BE — say so, do not pretend it was skipped.
 *
 * `skippedWrite` means "an identical write is already running", so the editor may
 * close: the text is safe inside that other write. Callers were also using it for
 * "there is no signed-in user" and "the document is gone", where NOTHING holds the
 * text — the editor closed, the fields cleared, and the person lost what they typed
 * without a single word. Those cases belong here instead: acceptance REJECTS, the
 * editor keeps the draft, and the shared refusal wording applies.
 */
export function refusedWrite(
  code: 'unauthenticated' | 'not-found',
  message: string,
  /**
   * What the PERSON reads, already translated. REQUIRED, because this is the only way
   * such a refusal can be heard at all: the write never becomes a mutation, so no
   * recovery descriptor will ever see it, and editors are silent by rule. Making it
   * optional produced exactly the silence it was introduced to prevent.
   */
  announce: string
): WriteSubmission {
  /**
   * This refusal has no reporter of its own: every other one is announced by the hook's
   * recovery descriptor, which watches React Query mutations — and this write never
   * becomes one. So it speaks here, once, and no editor repeats it.
   */
  const refusal = Object.assign(new Error(message), { code });
  showRecoverableWriteFailure({
    error: refusal,
    title: announce,
    // Nothing was sent, so there is no stored text to hand back — the person's words
    // are still in the editor they are looking at.
    description: '',
    retryLabel: '',
    retry: () => undefined,
    copyLabel: '',
    id: `write-recovery:local-refusal:${code}`,
  });
  return persistedWrite(Promise.reject(refusal));
}


/**
 * Nothing was started. NOT a success: the editor may close, but no message about
 * saving may be shown.
 *
 * `in-flight` — the same write is already running, so the text is safe inside it.
 * `awaiting-confirmation` — the action opened a dialog instead of writing; naming this
 * separately keeps callers from labelling a question as a duplicate write.
 */
export function skippedWrite(
  reason: 'in-flight' | 'awaiting-confirmation' = 'in-flight'
): WriteSubmission {
  return {
    acceptance: Promise.resolve<WriteAcceptance>({ kind: 'skipped', reason }),
    persistence: Promise.resolve(),
  };
}

/**
 * Wrap a launch-time mutation whose acceptance signal is the durable queue itself.
 * Used where `mutate()` is deliberately not awaited (offline-first): the write is
 * accepted the moment React Query owns it, and a later refusal reaches the editor
 * through `onLateFailure` in `awaitAcceptance`.
 */
export function queuedMutation(receipt: string, request: Promise<unknown>): WriteSubmission {
  return queuedWrite(receipt, request);
}

/**
 * The STRONGEST acceptance available offline: wait until the write is visible in the
 * client SDK's own local replica, then report `queued`.
 *
 * Why it is worth the extra code: `queuedMutation` accepts on LAUNCH — ownership is
 * assumed. Here ownership is OBSERVED: the document really carries this payload, so
 * the editor closes on evidence rather than on optimism, and an early refusal (which
 * rejects `request` before the replica ever shows it) still keeps the draft on screen.
 *
 * `waitForReplica` resolves when the caller sees its own payload in a snapshot — the
 * caller owns that check because only it knows the document's shape.
 */
export function replicaAcceptedWrite(
  receipt: string,
  replica: { seen: Promise<void>; stop: () => void },
  request: Promise<unknown>
): WriteSubmission {
  const persistence = request.then(() => undefined);
  /**
   * Two INDEPENDENT channels of evidence, and neither may veto the other.
   *
   * A plain `Promise.race` looked equivalent and was not, in two ways that both cost
   * the person their edit:
   *
   *   1. OFFLINE THE REPLICA NEVER SPEAKS. `conflictSafeUpdate` stores an offline edit
   *      in its OWN outbox (IndexedDB) and throws `OfflineQueuedError` — Firestore is
   *      never written, so the local replica has nothing to show. The race then saw a
   *      rejection, called a successfully stored edit a refusal, and rolled it back.
   *   2. A FAILING OBSERVER IS NOT A FAILING WRITE. If `onSnapshot` errors (a denied
   *      READ, say) while the write itself succeeds, the rejected watcher won the race
   *      and the person was told their saved edit had failed.
   *
   * So: either channel may ACCEPT; only `persistence` may REFUSE.
   */
  const acceptance = new Promise<WriteAcceptance>((resolve, reject) => {
    replica.seen.then(
      () => resolve({ kind: 'queued', receipt }),
      // The watcher died; the write may still be fine. Say nothing and let
      // `persistence` — the only channel that knows the write's fate — decide.
      () => undefined
    );
    persistence.then(
      () => resolve({ kind: 'persisted' }),
      (error) => {
        if (isOfflineQueuedError(error)) {
          resolve({ kind: 'queued', receipt });
          return;
        }
        reject(error);
      }
    );
  });
  // `Promise.race` does NOT cancel the loser, so a refusal left the replica listener
  // subscribed forever and every retry stacked another one. Stopping it on ANY outcome
  // is the difference between a watcher and a leak.
  void acceptance.then(
    () => replica.stop(),
    () => replica.stop()
  );
  void persistence.catch(() => undefined);
  void acceptance.catch(() => undefined);
  return { acceptance, persistence };
}

/**
 * THE EDITOR SIDE. Await this before closing.
 *
 * Returns the acceptance so the caller can branch on it — and the branch is the
 * whole point: `persisted` is the ONLY value that may be announced as saved.
 * A refusal that arrives BEFORE acceptance rejects (the editor keeps the draft);
 * one that arrives AFTER goes to `onLateFailure`, because by then the editor may
 * already be closed and the recovery toast owns the text.
 */
export async function awaitAcceptance(
  submission: WriteSubmission,
  onLateFailure: (error: unknown) => void
): Promise<WriteAcceptance> {
  let accepted = false;
  let earlyFailure: unknown;
  let hasEarlyFailure = false;

  void submission.persistence.catch((error) => {
    // Queueing is not failing. `conflictSafeUpdate` signals a stored offline intent by
    // THROWING `OfflineQueuedError`, so treating every rejection as a failure turned a
    // successful offline save into a refusal — and rolled the person's edit back.
    if (isOfflineQueuedError(error)) return;
    if (accepted) {
      onLateFailure(error);
      return;
    }
    earlyFailure = error;
    hasEarlyFailure = true;
  });

  const acceptance = await submission.acceptance;
  if (hasEarlyFailure) throw earlyFailure;
  accepted = true;
  return acceptance;
}

/**
 * Announce success ONLY for a write the server actually has. Offline (`queued`) and
 * no-op (`skipped`) stay silent by construction — there is no code path here that
 * can announce them, which is the difference between a rule and a guarantee.
 */
export function announceIfPersisted(
  acceptance: WriteAcceptance,
  announce: () => void
): void {
  if (acceptance.kind === 'persisted') announce();
}

/**
 * Describes how ONE write reports a terminal refusal. Owned by the write, not by
 * the page: a refusal must be reported by something that knows whose write it is,
 * and page-local subscriptions are exactly why some operations reported nothing.
 */
export interface WriteRecoveryDescriptor<TVars> {
  /** The mutation key this recovery belongs to. */
  mutationKey: readonly unknown[];
  /** Title when the failure is NOT a refusal. */
  fallbackTitleKey: string;
  /**
   * Wording for a REFUSAL, when the shared one does not fit. The shared key promises
   * "your text is still here" — true for an editor, meaningless for a switch or a
   * reorder, where nothing was typed. Such writes point here instead of pretending
   * there is text to recover.
   */
  refusalTitleKey?: string;
  /** Interpolation for the title, e.g. `{ name: vars.title }`. */
  titleParams?: (vars: TVars) => Record<string, unknown>;
  /** VERBATIM text the person typed — everything they would otherwise have to retype. */
  recoveryText: (vars: TVars) => string | undefined;
  /** Stable toast id, so a remount reports the same failure once, not twice. */
  toastId: (vars: TVars) => string;
  /**
   * MANDATORY, and mandatory on purpose.
   *
   * Failed mutations are persisted to a SHARED IndexedDB cache that outlives the
   * session. Without this guard, signing in as someone else replays the previous
   * account's refusals: their series title, their notes, their draft — verbatim, with a
   * "copy my text" button. Making the field optional meant "forgot to think about it"
   * and "deliberately unrestricted" looked identical, and several descriptors silently
   * ended up in the first group.
   *
   * Return false for anything this screen does not own. When a write genuinely has no
   * owner to compare (an anonymous or device-local operation), say so explicitly with
   * `() => true` and a comment — a visible decision, not an omission.
   */
  owns: (vars: TVars) => boolean;
  /**
   * Anything whose arrival can CHANGE the answer `owns` gives — typically the loaded
   * list this hook judges ownership against. When it changes, restored failures are
   * examined again; without it a failure skipped while the list was still loading was
   * never looked at a second time.
   */
  ownershipEpoch?: string;
  /**
   * Failures this reporter must leave alone because something closer to the person
   * already explains them — a form's own validation message, for instance.
   */
  ignore?: (error: unknown) => boolean;
  /** Re-fire the same write with the same variables. */
  retry: (vars: TVars) => void;
}

/**
 * Register terminal-refusal reporting for a write. Every entity gets this the same
 * way, so the wording, the returned text and the offline silence are INHERITED
 * rather than re-implemented — the previous per-hook copies drifted, and three
 * operations ended up reporting nothing at all.
 */
export function useWriteRecovery<TVars>(
  queryClient: QueryClient,
  descriptor: WriteRecoveryDescriptor<TVars>
): void {
  const reported = useRef(new WeakSet<object>());
  const reportedEpoch = useRef('');
  const { t } = useTranslation();
  const descriptorRef = useRef(descriptor);
  descriptorRef.current = descriptor;
  /**
   * OWNERSHIP CAN BECOME KNOWABLE LATER, and the answer must be asked again when it
   * does. A restored failure is examined once at mount; at that moment the entity list
   * is often still loading, so `owns` says "not mine", the mutation is skipped — and
   * nothing ever re-examines it. The person's refused text then stays unreachable for
   * the rest of the session. Re-subscribing whenever the ownership answer could have
   * changed re-runs the initial scan, and `reported` keeps it from speaking twice.
   */
  const ownershipEpoch = descriptor.ownershipEpoch ?? '';
  /**
   * The per-hook memory of "already said" must not outlive the SESSION either. Signing
   * out clears the shared record, but this local one lived in a ref: a person who signed
   * back in never saw their own unresolved refusal again, because this hook still
   * believed it had reported it. The epoch carries the signed-in user, so a new session
   * starts with a clean memory while an ordinary list update does not.
   */
  if (reportedEpoch.current !== ownershipEpoch) {
    const previousUser = reportedEpoch.current.split(':')[0];
    const currentUser = ownershipEpoch.split(':')[0];
    if (previousUser !== currentUser) reported.current = new WeakSet<object>();
    reportedEpoch.current = ownershipEpoch;
  }

  useEffect(
    () =>
      subscribeToTerminalMutationFailures({
        queryClient,
        reported: reported.current,
        report: (mutation) => {
          const current = descriptorRef.current;
          if (JSON.stringify(mutation.options.mutationKey) !== JSON.stringify(current.mutationKey)) {
            return false;
          }

          const vars = mutation.state.variables as TVars | undefined;
          if (vars === undefined) return false;
          if (current.owns && !current.owns(vars)) return false;
          // A queued intent is not a failure: it is stored and will replay.
          if (isOfflineQueuedError(mutation.state.error)) return false;
          if (current.ignore?.(mutation.state.error)) return false;

          const description = current.recoveryText(vars) ?? '';
          /**
           * A REFUSAL FROM A PREVIOUS SESSION IS ONLY WORTH REPEATING IF IT STILL HOLDS
           * SOMETHING TO LOSE. A refused toggle carries no text, so restoring it on every
           * launch showed a red "your change was refused" on whatever page the person
           * happened to open — with no way to tell WHICH change, and no way to act on it.
           * It was already said in the session where it happened; here it is only noise,
           * so it is dropped from the cache instead of accumulating forever. A refusal
           * that carries the person's draft still comes back, which is the whole point.
           */
          if (!description.trim() && (mutation.state.submittedAt ?? 0) < SESSION_STARTED_AT) {
            queryClient.getMutationCache().remove(mutation);
            return false;
          }

          const sharedKey = writeFailureTranslationKey(
            mutation.state.error,
            current.fallbackTitleKey
          );
          const titleKey =
            sharedKey === 'writeRecovery.refused' && current.refusalTitleKey
              ? current.refusalTitleKey
              : sharedKey;

          showRecoverableWriteFailure({
            error: mutation.state.error,
            title: t(titleKey, current.titleParams?.(vars)),
            description,
            retryLabel: t('buttons.retry'),
            retry: () => current.retry(vars),
            copyLabel: t('freshness.copyTextAction'),
            id: current.toastId(vars),
          });
          return true;
        },
      }),
    [queryClient, t, ownershipEpoch]
  );
}
