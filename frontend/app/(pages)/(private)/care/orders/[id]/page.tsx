'use client';

import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@/components/ui/Chip';
import { useServiceOrders } from '@/hooks/useServiceOrders';
import {
  isOfflineQueuedError,
  isStaleWriteError,
  isUnreachableWriteError,
} from '@/services/conflictSafeUpdate.client';
import { newClientId } from '@/utils/clientId';
import { CARE_CARD_TONES } from '@/utils/themeColors';

import { ReorderArrows, ServiceOrderFailure } from '../ReorderArrows';

import type { ServiceOrderStep } from '@/models/models';
import '@locales/i18n';

/**
 * ONE ORDER OF SERVICE — the page a pastor fills with his own words.
 *
 * The screen's job, in one sentence: he writes into the order he will lead. Everything here
 * serves that. The sequence of steps arrives with the rite; the words never do, so at rest an
 * unfilled step says plainly that its words are missing rather than showing a specimen he
 * might read out by accident.
 *
 * REST AND EDIT ARE SEPARATE. At rest the page is a page: type, spacing, nothing to press by
 * mistake. Everything that changes the order — the fields, the handles, adding, removing —
 * comes out under "Изменить" and goes away under "Готово". This is the same division the list
 * uses for arranging, and for the same reason: a control for a rare job should not stand in
 * front of the common one.
 *
 * WORDS ARE SAVED WHEN THE FIELD IS LEFT, never only on "Готово". A pastor types a paragraph
 * and closes the laptop; a save that waits for a button is a paragraph waiting to be lost.
 */

const tone = CARE_CARD_TONES.emerald;

/**
 * The pending-write key for the name of the rite. Step keys are `<step id>:<field>`, and a
 * client id never spells this, so the two can never take each other's place in the queue.
 */
const TITLE_KEY = 'title';

/**
 * The question a marker under this name asks is not "are these words saved" but "is this step
 * there at all" — which is why a committed answer that simply CONTAINS the step settles it.
 */
const EXISTENCE = 'existence';

/** What one write is, beyond the change itself: how to take it back, and what it is about. */
type WriteOptions = {
  /** The exact opposite of this change, applied if it is refused. */
  undo?: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null;
  /** The one field this write carries, whose words are on the screen and nowhere else. */
  field?: { stepId: string; name: string; value?: string };
  /** A step this change took OUT of the rite. */
  removed?: string;
  /** A step this change BROUGHT INTO BEING, which may survive its own refusal. */
  created?: string;
  /** A step this change only MOVED: if the server says it is gone, it goes from here too. */
  dropOnGone?: string;
};

/**
 * One field of a step as a single comparable value, and the value a patch is putting into it.
 * Used to ask the only question that can settle a write whose fate was never reported: does the
 * rite the server just handed back already carry exactly what that write was trying to store?
 */
const fieldValue = (step: ServiceOrderStep, field: string): string | undefined => {
  if (field === 'title') return step.title;
  if (field === 'body') return step.body ?? '';
  if (field === 'refs') return JSON.stringify(step.scriptureRefs ?? []);
  if (field === 'flagged') return String(Boolean(step.flagged));
  return undefined;
};

const patchedValue = (patch: Partial<ServiceOrderStep>, field: string): string | undefined => {
  if (field === 'title') return patch.title;
  if (field === 'body') return patch.body ?? '';
  if (field === 'refs') return JSON.stringify(patch.scriptureRefs ?? []);
  if (field === 'flagged') return String(Boolean(patch.flagged));
  return undefined;
};

/** Raised inside the transaction when the step this write is about is no longer in the rite. */
class StepGoneError extends Error {
  constructor() {
    super('SERVICE_ORDER_STEP_GONE');
    this.name = 'StepGoneError';
  }
}

/** "Ин. 11:25–26, Пс. 22" as the person types it, into the list the document stores. */
const parseRefs = (value: string): string[] =>
  value
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);

/**
 * THE ROUTE'S HALF. It knows which service is open and nothing else — and it hands the editor a
 * KEY, which is the whole point: when the router swaps one service for another under this page,
 * React unmounts the old editor instead of the old editor having to notice. Its cleanup then
 * flushes whatever was still waiting, and the new one starts with its own state and its own
 * timers. Before this, the swap was handled by clearing refs during render, which is both a
 * React rule broken and a silent way to lose the last sentence typed.
 */
export default function ServiceOrderPage() {
  const { id } = useParams();
  const orderId = typeof id === 'string' ? id : '';
  return <ServiceOrderEditor key={orderId} orderId={orderId} />;
}

/**
 * THE WAY BACK, in the words of the place it returns to. It stands on all three faces of this
 * page — the rite, the rite that could not be found, and the rite that was deleted while it was
 * open — and it was written out three times before one of them drifted.
 */
function BackToList({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <Link
      href="/care/orders"
      className={`inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200 ${className}`}
    >
      <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      {t('serviceOrders.backToList')}
    </Link>
  );
}

function ServiceOrderEditor({ orderId }: { orderId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();

  const { orders, loading, isOnline, updateSteps, openedWith, closedEditing, recheck, renameOrder, deleteOrder } =
    useServiceOrders();
  const order = orders.find((candidate) => candidate.id === orderId);
  /** Always the current document, for a write that runs long after the keystroke that armed it. */
  const orderRef = useRef(order);
  orderRef.current = order;
  /** The rite as it was last seen, for the one screen that has to speak about it once it is gone. */
  const lastKnown = useRef(order);
  if (order) lastKnown.current = order;

  /**
   * ONE LOCAL TRUTH FOR WHAT IS ON SCREEN.
   *
   * The fields are controlled from this mirror, so what a person sees, what will be written and
   * what the page believes are the same value. `null` means "nothing unsaved here" — then the
   * screen simply follows the document, which is how a change made on another device shows up.
   */
  const [typed, setTyped] = useState<ServiceOrderStep[] | null>(null);
  const liveSteps = typed ?? order?.steps ?? [];
  /** Always the current mirror, for code that runs after an await and must not read a stale one. */
  const typedRef = useRef<ServiceOrderStep[]>(liveSteps);
  typedRef.current = liveSteps;

  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; run: () => void }>());

  // An order just created opens ready to be written in: its name is a placeholder, and the first
  // thing its owner wants is to replace it.
  const [editing, setEditing] = useState(searchParams?.get('new') === '1');

  /**
   * ONE NAME FOR ONE SITTING AT THIS RITE.
   *
   * The guard's baseline is released behind whatever is still being written, which can be after
   * the pastor has already pressed "Изменить" again. Without a name for the sitting, that late
   * release took the baseline out from under the new one, and its first rename went to the
   * server with nothing to be refused against.
   */
  const [session, setSession] = useState(() => newClientId());
  const startEditing = () => {
    if (!editing) setSession(newClientId());
    setEditing((was) => !was);
  };

  const [failure, setFailure] = useState<string | null>(null);

  /**
   * ONE STRUCTURAL CHANGE AT A TIME. Typing is never held up.
   *
   * Adding, removing and moving a step all rearrange the same list, and while one of them is in
   * the air its answer may still be "no". Letting a second one start meant the first one's undo
   * had to be reconciled against a shape that had moved underneath it — by position, which no
   * longer meant the same thing. Two rounds of review found a different way for that to end
   * wrong, and the third would have found another: the cure is that there is nothing to
   * reconcile. Words are a different matter and stay editable throughout.
   */
  const [rearranging, setRearranging] = useState(false);

  /**
   * AN ABSENT RITE IS A QUESTION FOR THE SERVER, NOT AN ANSWER FROM THE CACHE.
   *
   * The list is read cache-first and counts as fresh for half a minute, so a rite created on
   * the laptop and opened on the phone a moment later is simply not in it — and the page said
   * it had been deleted. One deliberate read settles it, and it is a read that refuses to
   * answer from the cache: "gone" is only ever said because the server said so. Until it
   * answers the page shows nothing rather than a sentence it cannot support.
   */
  /** What he has typed into a references field while he is still in it, exactly as typed. */
  const [refsDraft, setRefsDraft] = useState<Record<string, string>>({});

  /**
   * And the name, for the same reason: until a save comes back, the only place it exists is the
   * field he typed it into — which the rite's own screen stops rendering the moment the rite is
   * deleted elsewhere. What is not held is what cannot be shown back to him.
   */
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const [verdict, setVerdict] = useState<'checking' | 'absent' | 'unreachable' | null>(null);
  const rechecked = useRef(false);

  useEffect(() => {
    if (order || loading || !isOnline || rechecked.current) return;
    rechecked.current = true;
    setVerdict('checking');
    let gone = false;
    /*
     * A read that crossed a write proves nothing either way, so it is simply asked again — a
     * few times, and then the page says "not here yet" rather than inventing a deletion. No
     * timer: each attempt is one question, and the answers run out.
     */
    const ask = async (attemptsLeft: number): Promise<void> => {
      const answer = await recheck(orderId);
      if (gone) return;
      if (answer === 'overlapped' && attemptsLeft > 0) return ask(attemptsLeft - 1);
      if (answer === 'found') return setVerdict(null);
      setVerdict(answer === 'overlapped' ? 'unreachable' : answer);
    };
    void ask(2);
    return () => {
      gone = true;
    };
  }, [order, loading, isOnline, recheck, orderId]);

  /**
   * A REFUSED WRITE, A QUEUED WRITE AND A CONFLICT ARE THREE DIFFERENT ANSWERS.
   *
   * They used to be one sentence — "could not save" — and that sentence was a lie in two of
   * the three cases: a write queued offline WILL be saved, and a conflict means someone else's
   * version is now on the server, not that the text went nowhere. A person told "failed" about
   * a queued write retypes it; told "failed" about a conflict, he never learns there is
   * another version at all.
   */
  const describeFailure = (error: unknown): string => {
    console.error('serviceOrder write failed', error);
    if (error instanceof StepGoneError) return t('serviceOrders.stepGone') as string;
    if (isOfflineQueuedError(error)) return t('serviceOrders.writeQueued') as string;
    /*
     * Only the sentence belongs here. Taking the server's version as the new baseline is the
     * hook's work — it is the side that serialises the writes, and a baseline kept anywhere else
     * is stale by the time the next one runs.
     */
    if (isStaleWriteError(error)) return t('serviceOrders.writeConflict') as string;
    /*
     * "WE DO NOT KNOW" IS ITS OWN ANSWER, and the most dangerous one to dress up as a refusal.
     * A transaction that times out or loses the connection may already have committed; calling
     * that a refusal and undoing the change on screen turns a saved rite into an unsaved-looking
     * one, and the next edit is then made against a version that no longer exists.
     */
    if (isUnreachableWriteError(error)) return t('serviceOrders.writeUnknown') as string;
    return t('serviceOrders.writeFailed') as string;
  };

  /**
   * SAVED WHILE HE TYPES, not only when he leaves the field.
   *
   * Blur used to be the only trigger, and blur is exactly the event that does not happen when
   * a phone is locked, a laptop lid is closed or a PWA is killed in the background. A pastor
   * would have written a paragraph and lost it with nothing on screen suggesting he might.
   * Keystrokes are coalesced so a sentence is one write, and leaving the field still flushes
   * immediately — the blur is now a shortcut, not the guarantee.
   */

  /**
   * WHATEVER IS STILL WAITING GETS SENT, it is never thrown away.
   *
   * The first version of this cleanup only cleared the timers — so typing a sentence and
   * immediately going back lost it: unmount is not obliged to fire a blur, and the pending
   * write died with the component. `pagehide` covers the tab being closed and a phone being
   * put away, which is exactly when the last sentence matters most.
   */
  const flushAll = useCallback(() => {
    pending.current.forEach(({ timer, run }) => {
      clearTimeout(timer);
      run();
    });
    pending.current.clear();
  }, []);

  useEffect(() => {
    const onHide = () => flushAll();
    // Only on the way OUT. `visibilitychange` also fires on the way back in, and flushing then
    // sends a write for text the person is still in the middle of typing.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flushAll();
    };
  }, [flushAll]);

  /**
   * LEAVING EDIT MODE IS NOT A REASON TO THROW WORDS AWAY.
   *
   * It used to hand the screen straight back to the document, and that was a quiet way to lose
   * the last thing typed: the words are flushed on the way out, and a write flushed here can
   * still be refused a second later — by then the local copy holding them was already gone, so
   * the failure was announced about text that no longer existed anywhere. The screen goes back
   * to the document when a write SUCCEEDS, which is the only moment that proves it can.
   */
  useEffect(() => {
    if (!editing) return;
    return () => {
      /*
       * IN THIS ORDER, AND THE ORDER IS THE WHOLE POINT.
       *
       * What is waiting goes first, and the baseline is released behind it. The other way round
       * — which is what declaring this effect above the page-exit one quietly produced — the
       * baseline was deleted while a half-typed name was still on a timer, and that rename then
       * went to the server with nothing to be refused against: an unguarded write able to
       * overwrite a title another device had just changed.
       */
      flushAll();
      void closedEditing(orderId, session);
    };
  }, [editing, closedEditing, flushAll, orderId, session]);

  /**
   * Every pending write remembers WHICH service and WHICH generation it was made for. A timer
   * armed on one service and fired after the route swapped to another used to reach the new
   * editor's mirror — the funeral's sentence appearing inside the wedding.
   */
  const schedule = useCallback((key: string, run: () => void) => {
    const existing = pending.current.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      pending.current.delete(key);
      run();
    }, 700);
    pending.current.set(key, { timer, run });
  }, []);

  /** Runs what is waiting under this key, if anything is. Nothing waiting means nothing to do. */
  const flush = useCallback((key: string) => {
    const existing = pending.current.get(key);
    if (!existing) return;
    clearTimeout(existing.timer);
    pending.current.delete(key);
    existing.run();
  }, []);


  /**
   * Moves the mirror NOW. Called from the field's own change handler, not from the write: the
   * write waits 700ms, and a page that dies inside that window would otherwise leave the draft
   * holding the version from before the sentence was typed.
   */
  /**
   * Moves the mirror NOW and reports exactly what it moved to.
   *
   * Synchronous on purpose: the caller needs the post-change value before it awaits anything, and
   * reading it back from state a line later would hand it the version from before the keystroke.
   */
  /**
   * EVERY FIELD WHOSE LAST WRITE WAS REFUSED, AND WHAT WAS SAID ABOUT IT.
   *
   * Those words exist on this screen and nowhere else. Two things follow, and both were learned
   * the hard way. A later write that SUCCEEDS must not adopt the server's answer over them — it
   * never received the refused sentence, so its truthful answer would wipe the screen clean of
   * the very text the banner was about. And the banner itself must not be cleared by that
   * success: words left on screen with nothing said about them read as saved, and the next
   * reload takes them.
   *
   * The name of the rite belongs here too, under `null` — it is not a step, and a step id is
   * always a string, so the two can never be taken for one another.
   */
  const unresolved = useRef(new Map<string | null, Map<string, { said: string; value?: string }>>());

  const rememberRefusal = useCallback(
    (owner: string | null, field: string, said: string, value?: string) => {
      const fields =
        unresolved.current.get(owner) ?? new Map<string, { said: string; value?: string }>();
      fields.set(field, { said, value });
      unresolved.current.set(owner, fields);
    },
    []
  );

  /** That same field, saved at last. */
  const forgetRefusal = useCallback((owner: string | null, field: string) => {
    const fields = unresolved.current.get(owner);
    if (!fields) return;
    fields.delete(field);
    if (fields.size === 0) unresolved.current.delete(owner);
  }, []);

  /**
   * The sentence the page should be showing: whatever is still unsaved, or nothing. Recomputed
   * after every write, so the banner can never go on describing a failure that has since been
   * settled while a different one is still standing.
   */
  const stillUnsaid = useCallback((): string | null => {
    for (const fields of unresolved.current.values()) {
      for (const entry of fields.values()) return entry.said;
    }
    return null;
  }, []);

  /** Only the STEPS pin the mirror. An unsaved name lives in its own field, not in this list. */
  const stepRefusalsPending = useCallback(
    () => [...unresolved.current.keys()].some((owner) => owner !== null),
    []
  );

  /** Timers for the steps only — the name's timer is not a reason to hold the steps' mirror. */
  const stepWritesWaiting = useCallback(
    () => [...pending.current.keys()].some((key) => key !== TITLE_KEY),
    []
  );

  const mirror = useCallback(
    (mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null) => {
      const next = mutate(typedRef.current) ?? typedRef.current;
      typedRef.current = next;
      setTyped(next);
      return next;
    },
    []
  );

  /**
   * WHAT A FAILED WRITE DOES TO THE SCREEN, in one place.
   *
   * Three answers, three different things to do. A step the SERVER says is gone is gone: putting
   * it back would contradict the very sentence the page is about to show, and would resurrect
   * something no device has any more. A change whose fate is UNKNOWN — a transaction that timed
   * out or lost the connection — must not be undone either: it may well have committed, and
   * undoing it would show a rite that no longer matches the stored one. Only a definite refusal
   * is definitely undone, and then only by the inverse of its own operation, so newer words stay
   * exactly where they are.
   */
  const settleFailure = (
    error: unknown,
    options: WriteOptions | undefined
  ): string => {
    const said = describeFailure(error);
    const gone = error instanceof StepGoneError;
    const unknown = isUnreachableWriteError(error);

    if (options?.field) {
      rememberRefusal(options.field.stepId, options.field.name, said, options.field.value);
    }
    if (options?.undo && !gone && !unknown) mirror(options.undo);
    // A step that was only being MOVED, which the server no longer has, leaves the screen: a step
    // announced as gone while still sitting in the list is a page arguing with itself.
    if (gone && options?.dropOnGone) {
      const standing = typedRef.current.find((step) => step.id === options.dropOnGone);
      const empty =
        !standing || (!standing.title && !standing.body && (standing.scriptureRefs ?? []).length === 0);
      if (empty) {
        mirror((steps) => steps.filter((step) => step.id !== options.dropOnGone));
        unresolved.current.delete(options.dropOnGone);
      } else {
        /*
         * IT HAS WORDS IN IT, so it stays, and the sentence above says why. Taking it away was
         * tidier and it destroyed a paragraph: the step was filtered out of the screen while the
         * write carrying its words was still on its way to learn the same thing, and the words
         * had nowhere left to be. The same rule as writing into a step that is gone — the words
         * stay in front of the person who typed them.
         */
        rememberRefusal(options.dropOnGone, EXISTENCE, said);
      }
    }
    // The pastor's OWN removal of a step the server had already lost: nothing of it is left on
    // screen to keep a question open about.
    if (gone && options?.removed) unresolved.current.delete(options.removed);
    // A change whose fate is unknown keeps the screen pinned to it: nothing may adopt over it
    // until something authoritative settles the question.
    if (unknown && options?.created) rememberRefusal(options.created, EXISTENCE, said);
    if (unknown && options?.dropOnGone) rememberRefusal(options.dropOnGone, EXISTENCE, said);
    // A step that was created and then written into survives its own refusal: its words are on
    // this screen and nowhere else, and the undo leaves it standing for that reason.
    if (!unknown && options?.created && typedRef.current.some((step) => step.id === options.created)) {
      rememberRefusal(options.created, EXISTENCE, said);
    }
    return said;
  };

  const write = async (
    mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null,
    /**
     * ADDING, REMOVING AND MOVING A STEP COME BACK IF THEY ARE REFUSED; TYPED WORDS DO NOT.
     *
     * They are opposite risks. A refused structural change left on screen is a lie — the step
     * he removed is still on the server, and he will not find out until he reloads. Refused
     * words left on screen are the only copy there is, and taking them away to agree with the
     * server would throw away the very thing worth saving.
     */
    options?: WriteOptions
  ) => {
    /*
     * THE WARNING STANDS WHILE ANY WORDS ARE STILL UNSAVED.
     *
     * Clearing it at the start of every write made a refusal disappear the moment the next edit
     * succeeded: the refused paragraph stayed on the screen looking like ordinary saved content,
     * and a reload took it. The banner says whatever is still unsaved, or nothing at all.
     */
    setFailure(stillUnsaid());
    if (options?.undo) setRearranging(true);
    mirror(mutate);
    const sentSteps = typedRef.current;
    try {
      const committed = await updateSteps(orderId, mutate);
      /*
       * AN ANSWER IS ONLY WORTH ADOPTING IF THE EDITOR HAS NOT MOVED ON.
       *
       * Two things can make it worthless. The route may have swapped this page onto a different
       * service — then this answer belongs to the one the person left, and writing it here would
       * put a funeral's steps inside a wedding. Or the person may have typed the next field while
       * this write was in the air — then it carries the version from before that, and adopting it
       * would take the newer words off the screen. The write that carries them is already on its
       * way and will bring the truthful answer.
       */
      if (options?.field) forgetRefusal(options.field.stepId, options.field.name);
      /*
       * A step THIS EDITOR REMOVED takes its unresolved refusals with it — the pastor deleted
       * the step, words and all, so nothing is being lost. Only that step, and only because this
       * press removed it: inferring it from "absent on the server" would also cover a step
       * another device deleted, and those refused words are the only copy there is.
       */
      if (options?.removed) unresolved.current.delete(options.removed);
      /*
       * A committed answer that CONTAINS a step settles every question about whether that step
       * exists. Without this, a creation whose transport failed after committing stayed marked
       * unsaved for the rest of the session — the banner standing and the mirror pinned over
       * text the server had held all along. It settles nothing about a FIELD: that a step exists
       * is no proof that the paragraph refused inside it ever arrived.
       */
      if (committed) {
        committed.forEach((step) => {
          forgetRefusal(step.id, EXISTENCE);
          /*
           * And a field whose fate was never reported is settled by the same answer, when the
           * rite the server handed back already carries exactly what that write was trying to
           * store. Without this the page went on saying "it is not known whether this was saved"
           * about words the server plainly had.
           */
          const fields = unresolved.current.get(step.id);
          if (!fields) return;
          [...fields.entries()].forEach(([name, entry]) => {
            if (entry.value !== undefined && entry.value === fieldValue(step, name)) {
              forgetRefusal(step.id, name);
            }
          });
        });
      }
      // Whatever is still unsaved keeps the page talking about it; nothing left, nothing said.
      setFailure(stillUnsaid());
      if (!committed) return;
      /*
       * Adopted only if nothing newer was typed while this write was in the air. Two fields in a
       * row is an ordinary thing to do: the first write commits what it knew, and taking its
       * answer would lift the newer words off the screen. The write carrying them is already on
       * its way with the truthful one.
       */
      if (typedRef.current !== sentSteps) return;
      /*
       * NO STEP WRITE MAY BE WAITING EITHER.
       *
       * Type a sentence and add a step before the timer fires: the structural write goes to the
       * server, which knows nothing of the sentence, and comes back with a truthful answer that
       * does not contain it. Adopting it takes the sentence off the screen — and the next
       * keystroke lands on the version without it, so the words are lost for real. The write
       * carrying them is already on the timer; when it answers, nothing will be waiting.
       *
       * The NAME is counted out of this. It is not part of the steps, and a name still on its
       * timer would otherwise pin the mirror for the rest of the session — which is its own
       * quiet failure: the screen stops following the document and a change made elsewhere
       * never appears.
       */
      if (stepWritesWaiting()) return;
      // A refused write elsewhere in this rite is still unresolved, and its words are only here.
      if (stepRefusalsPending()) return;
      /*
       * Nothing is unsaved any more, so the mirror lets go: the hook has just cached exactly
       * these steps, and a screen pinned to a local copy would stop showing anything that
       * happened elsewhere for as long as the tab stayed open.
       */
      typedRef.current = committed;
      setTyped(null);
    } catch (error) {
      setFailure(settleFailure(error, options));
    } finally {
      if (options?.undo) setRearranging(false);
    }
  };

  /**
   * THE NAME IS SAVED ON THE SAME TERMS AS THE WORDS UNDER IT.
   *
   * It used to save on blur alone, while every field below it saved as it was typed — so the
   * one thing a person renames and immediately closes the page on was the one thing the page
   * did not keep. Blur is exactly the event that does not happen when a phone is locked or a
   * tab is closed. Through the same timer it is coalesced, flushed on leaving the field, and
   * caught by the same page-exit flush as everything else.
   */
  const saveTitle = async (value: string) => {
    const next = value.trim();
    /*
     * A rite with no name at all is the one value worth refusing here — and refusing it SAYS so.
     * Silently returning left the pastor watching his emptied field turn back into the old name
     * on "Готово", with nothing to explain why what he did had no effect.
     *
     * Whether the name has actually CHANGED is decided beside the queue, where the answer is not
     * one save out of date.
     */
    if (!next) {
      const said = t('serviceOrders.titleRequired') as string;
      rememberRefusal(null, TITLE_KEY, said);
      setFailure(said);
      return;
    }
    setFailure(stillUnsaid());
    try {
      await renameOrder(orderId, next, session);
      forgetRefusal(null, TITLE_KEY);
      // Only if it is still the name that was saved. Clearing it outright threw away a NEWER
      // one: type again while the first save is travelling, and the draft holding the second
      // name was dropped by the first one's success — leaving nothing to show him if the rite
      // then disappeared underneath it.
      setTitleDraft((current) => (current === next ? null : current));
      setFailure(stillUnsaid());
    } catch (error) {
      const said = describeFailure(error);
      // The typed name is in the field and nowhere else, exactly like a refused paragraph.
      rememberRefusal(null, TITLE_KEY, said);
      setFailure(said);
    }
  };

  /**
   * THE RITE IS GONE AND HIS WORDS ARE STILL HERE.
   *
   * Deleted on another device while this page was open, the rite simply left the list — and the
   * page showed "it is not here" over the top of a paragraph that existed in this browser and
   * nowhere else. Nothing said so, and leaving the page took it. So the words are shown instead,
   * plainly and selectably, with what happened said above them.
   */
  if (!order && (typed || titleDraft || unresolved.current.size > 0) && lastKnown.current) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <BackToList />

        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
          {titleDraft ?? lastKnown.current.title}
        </h1>

        <ServiceOrderFailure
          message={t('serviceOrders.goneWithWords') as string}
          testId="service-order-gone"
        />

        <ol className="mt-6 flex flex-col gap-5">
          {liveSteps.map((step, index) => (
            <li key={step.id} className="text-sm">
              <p className="font-bold text-gray-900 dark:text-white">
                {index + 1}. {step.title}
              </p>
              {step.body && (
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">
                  {step.body}
                </p>
              )}
              {/* As typed, comma and all, if he was in the middle of the field when it happened. */}
              {(refsDraft[step.id] ?? (step.scriptureRefs ?? []).join(', ')) && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {refsDraft[step.id] ?? (step.scriptureRefs ?? []).join(', ')}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if ((loading || verdict === 'checking') && !order) return null;

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-3xl py-16 text-center">
        {/*
          "IT IS GONE" IS SAID ONLY WHEN THE SERVER SAID IT.
          Offline, or with Firestore simply unreachable, an absent service means "this device
          has not seen it yet". Telling someone their service was deleted when it is sitting on
          the server is the kind of sentence that makes a person stop trusting the whole section.
        */}
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {verdict === 'absent' ? t('serviceOrders.notFound') : t('serviceOrders.notHereYet')}
        </p>
        <BackToList className="mt-4" />
      </div>
    );
  }

  /** Takes one step out of where it is and puts it back at `toIndex`. */
  const reposition = (steps: ServiceOrderStep[], stepId: string, toIndex: number) => {
    const from = steps.findIndex((step) => step.id === stepId);
    if (from < 0 || toIndex < 0 || toIndex >= steps.length) return null;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(toIndex, 0, moved);
    return next;
  };

  const moveStep = (stepId: string, toIndex: number) => {
    const from = liveSteps.findIndex((step) => step.id === stepId);
    return write(
      (steps) => {
        if (!steps.some((step) => step.id === stepId)) throw new StepGoneError();
        return reposition(steps, stepId, toIndex);
      },
      { undo: (steps) => reposition(steps, stepId, from), dropOnGone: stepId }
    );
  };

  /**
   * A STEP THAT IS NO LONGER THERE IS NOT A STEP THAT WAS SAVED.
   *
   * The mutator runs inside the transaction, against the rite as it now IS. If another device
   * removed this step meanwhile, mapping over the list finds nothing to change and hands back
   * an array that looks perfectly valid — so the write reported success, the words were dropped
   * as confirmed, and they existed nowhere. Refusing says what happened while the words are
   * still in the field in front of the person who wrote them.
   */
  const patchStep = (stepId: string, field: string, patch: Partial<ServiceOrderStep>) =>
    write(
      (steps) => {
        if (!steps.some((step) => step.id === stepId)) throw new StepGoneError();
        return steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
      },
      // Remembered by FIELD, like the timers. Under the step alone, saving that step's heading
      // a moment later cleared the marker its BODY had left, and the refused paragraph was
      // adopted away with it. Kept as a pair rather than a joined string, so a step id that
      // happens to contain a colon cannot be read as belonging to another step.
      { field: { stepId, name: field, value: patchedValue(patch, field) } }
    );

  /**
   * The id is minted ONCE, outside the mutator. It used to be created inside, so a write that
   * was retried — which this path deliberately allows — appended a SECOND step instead of
   * repeating the first. Now a replay finds its own step already there and does nothing.
   */
  const addStep = () => {
    const step: ServiceOrderStep = { id: newClientId(), title: '', body: '', scriptureRefs: [] };
    return write((steps) => (steps.some((s) => s.id === step.id) ? null : [...steps, step]), {
      created: step.id,
      undo: (steps) => {
        const standing = steps.find((entry) => entry.id === step.id);
        if (!standing) return null;
        // Still empty — it was never anything, so it goes. Written into — it stays, because
        // those words exist here and nowhere else.
        const untouched =
          !standing.title && !standing.body && (standing.scriptureRefs ?? []).length === 0;
        return untouched ? steps.filter((entry) => entry.id !== step.id) : null;
      },
    });
  };

  const removeStep = (stepId: string) => {
    /*
     * The words go FIRST, even though the step is about to be removed.
     *
     * Cancelling them looked tidy and was a quiet way to lose text: if the removal is then
     * refused, the step comes back on the next read without the sentence that was typed into it,
     * and nothing ever said so. Writes for one service are serialised, so the text lands before
     * the removal and costs nothing when the removal succeeds.
     */
    pending.current.forEach((entry, key) => {
      if (key.startsWith(`${stepId}:`)) flush(key);
    });
    const removed = liveSteps.find((step) => step.id === stepId);
    const wasAt = liveSteps.findIndex((step) => step.id === stepId);
    return write(
      (steps) => {
        // The same rule as writing into it: a step that is already gone was not removed by
        // this press, and reporting success for it bumps the revision over nothing.
        if (!steps.some((step) => step.id === stepId)) throw new StepGoneError();
        return steps.filter((step) => step.id !== stepId);
      },
      {
        removed: stepId,
        undo: (steps) => {
          // Something else may have put it back meanwhile; then there is nothing to undo.
          if (!removed || steps.some((step) => step.id === stepId)) return null;
          const at = Math.min(Math.max(wasAt, 0), steps.length);
          return [...steps.slice(0, at), removed, ...steps.slice(at)];
        },
      }
    );
  };

  const remove = async () => {
    if (!window.confirm(t('serviceOrders.deleteConfirm') as string)) return;
    // Same rule as a removed step: whatever was typed is sent before the document goes, so a
    // refused deletion cannot swallow it.
    pending.current.forEach((_entry, key) => flush(key));
    try {
      await deleteOrder(orderId);
      router.push('/care/orders');
    } catch (error) {
      setFailure(describeFailure(error));
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/*
        THE WAY BACK IS ON THE PAGE, not only in the trail above it. The owner looked for it
        and could not find one — "не очевидно, где она, как она" — and he is right: a line of
        small grey crumbs is where a page says where it IS, not where a person reaches to
        leave. One line, one arrow, in the words of the place it returns to.
      */}
      <BackToList />

      <header className="mt-4">
        <div className="flex items-center justify-between gap-4">
          {editing ? (
            <input
              defaultValue={order.title}
              aria-label={t('serviceOrders.orderTitle') as string}
              onFocus={() =>
                openedWith(orderId, { title: order.title, revision: order.rev?.meta ?? 0 }, session)
              }
              onChange={(event) => {
                const next = event.target.value;
                setTitleDraft(next);
                schedule(TITLE_KEY, () => saveTitle(next));
              }}
              onBlur={() => flush(TITLE_KEY)}
              className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-2xl font-extrabold tracking-tight text-gray-900 focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          ) : (
            <h1 className="min-w-0 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
              {order.title}
            </h1>
          )}

          <button
            type="button"
            onClick={startEditing}
            className={`inline-flex shrink-0 items-center rounded-full px-5 py-2.5 text-sm font-bold transition ${
              editing
                ? 'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500'
                : 'border border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            {editing ? t('serviceOrders.done') : t('serviceOrders.edit')}
          </button>
        </div>

        {order.summary && !editing && (
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            {order.summary}
          </p>
        )}
      </header>

      {failure && <ServiceOrderFailure message={failure} testId="service-order-failure" />}

      {liveSteps.length === 0 && !editing && (
        <p className="mt-8 text-sm text-gray-500 dark:text-gray-400">
          {t('serviceOrders.emptySteps')}
        </p>
      )}

      {/*
        RENDERED FROM THE LOCAL TRUTH, not from the cache.
        While `defaultValue` held the text, the screen showed the last CONFIRMED version and the
        mirror held the typed one — so restoring a draft wrote the rescued words to the server
        while the fields in front of the person still showed the old ones, ready to be typed over
        again. One source removes the whole class.
      */}
      <ol className="mt-7 flex flex-col gap-2">
        {liveSteps.map((step, index) => (
          <li key={step.id}>
            <div
              data-testid={`service-order-step-${index}`}
              className={`flex gap-3 rounded-2xl border p-4 ${
                editing
                  ? 'border-emerald-200 bg-white dark:border-emerald-900/60 dark:bg-gray-900'
                  : 'border-transparent'
              }`}
            >
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold ${tone.wash} ${tone.icon}`}
                aria-hidden="true"
              >
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <input
                      value={step.title}
                      placeholder={t('serviceOrders.stepTitle') as string}
                      aria-label={t('serviceOrders.stepTitle') as string}
                      onChange={(event) => {
                        const next = event.target.value;
                        mirror((steps) =>
                          steps.map((entry) => (entry.id === step.id ? { ...entry, title: next } : entry))
                        );
                        schedule(`${step.id}:title`, () => patchStep(step.id, 'title', { title: next }));
                      }}
                      onBlur={() => flush(`${step.id}:title`)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-900 focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    />
                    <textarea
                      value={step.body ?? ''}
                      rows={3}
                      placeholder={t('serviceOrders.stepWords') as string}
                      aria-label={t('serviceOrders.stepWords') as string}
                      onChange={(event) => {
                        const next = event.target.value;
                        mirror((steps) =>
                          steps.map((entry) => (entry.id === step.id ? { ...entry, body: next } : entry))
                        );
                        schedule(`${step.id}:body`, () => patchStep(step.id, 'body', { body: next }));
                      }}
                      onBlur={() => flush(`${step.id}:body`)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-800 focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
                    />
                    <input
                      /*
                       * WHAT HE TYPED, LETTER FOR LETTER, while he is typing it.
                       *
                       * The field used to show the parsed list joined back together, and the
                       * comma that separates two references vanished the instant it was typed:
                       * the parser dropped the empty part after it, the list was joined without
                       * it, and the next reference was written onto the end of the first. An
                       * ordinary keyboard, not an edge case. The list is still what gets saved.
                       */
                      value={refsDraft[step.id] ?? (step.scriptureRefs ?? []).join(', ')}
                      placeholder={t('serviceOrders.refsHint') as string}
                      aria-label={t('serviceOrders.refs') as string}
                      // The same rules as the words above: mirrored on the keystroke so the
                      // draft holds them, written after the pause, flushed early on leaving.
                      onChange={(event) => {
                        const typedRefs = event.target.value;
                        setRefsDraft((drafts) => ({ ...drafts, [step.id]: typedRefs }));
                        const next = parseRefs(typedRefs);
                        mirror((steps) =>
                          steps.map((entry) =>
                            entry.id === step.id ? { ...entry, scriptureRefs: next } : entry
                          )
                        );
                        schedule(`${step.id}:refs`, () => patchStep(step.id, 'refs', { scriptureRefs: next }));
                      }}
                      onBlur={() => {
                        flush(`${step.id}:refs`);
                        // Leaving the field hands it back to the stored list, tidily separated.
                        setRefsDraft((drafts) => {
                          const rest = { ...drafts };
                          delete rest[step.id];
                          return rest;
                        });
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs text-gray-700 focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300"
                    />

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => patchStep(step.id, 'flagged', { flagged: !step.flagged })}
                        aria-pressed={Boolean(step.flagged)}
                        className={`rounded-full border px-3 py-1 text-[11px] font-bold transition ${
                          step.flagged
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                            : 'border-gray-300 text-gray-500 hover:border-gray-400 dark:border-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {t('serviceOrders.flag')}
                      </button>

                      <span className="flex-1" />

                      <ReorderArrows
                        canMoveUp={index > 0 && !rearranging}
                        canMoveDown={index < liveSteps.length - 1 && !rearranging}
                        onMoveUp={() => moveStep(step.id, index - 1)}
                        onMoveDown={() => moveStep(step.id, index + 1)}
                        upLabel={t('serviceOrders.moveUp') as string}
                        downLabel={t('serviceOrders.moveDown') as string}
                      />
                      <button
                        type="button"
                        onClick={() => removeStep(step.id)}
                        disabled={rearranging}
                        aria-label={t('serviceOrders.removeStep') as string}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold tracking-tight text-gray-900 dark:text-gray-100">
                        {step.title}
                      </span>
                      {step.flagged && (
                        <Chip tone="amber" size="xs" weight="bold">
                          {t('serviceOrders.flag')}
                        </Chip>
                      )}
                    </div>

                    {step.body ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        {step.body}
                      </p>
                    ) : (
                      // Says the words are missing rather than showing a specimen he could
                      // read out by accident. The app never supplies wording here.
                      <p className="mt-1 text-sm text-gray-300 dark:text-gray-600">
                        {t('serviceOrders.stepEmpty')}
                      </p>
                    )}

                    {(step.scriptureRefs ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(step.scriptureRefs ?? []).map((ref) => (
                          <Chip key={ref} tone="emerald" size="xs" weight="bold">
                            {ref}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {editing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={addStep}
            disabled={rearranging}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-600 transition hover:border-emerald-400 hover:text-emerald-700 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {t('serviceOrders.addStep')}
          </button>

          {/* Destructive, so it sits last, quiet, and asks before it acts. */}
          <button
            type="button"
            onClick={remove}
            /* Needs a connection: a deletion queued offline arrives whenever the signal does,
               and takes with it whatever another device wrote in between. */
            disabled={!isOnline}
            title={!isOnline ? (t('serviceOrders.deleteOffline') as string) : undefined}
            className="text-sm font-semibold text-rose-600 transition hover:text-rose-700 disabled:opacity-40 dark:text-rose-400"
          >
            {t('serviceOrders.deleteOrder')}
          </button>
        </div>
      )}
    </div>
  );
}
