'use client';

import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ScriptureLinks, ScriptureText, WrittenInMark } from '@/components/bible/ScriptureLinks';
import { useVerseWindow } from '@/components/bible/VerseWindow';
import { ServiceOrderDraftRecovery } from '@/components/care/ServiceOrderDraftRecovery';
import { ServiceOrderPlacementHistory } from '@/components/care/ServiceOrderPlacementHistory';
import { ServiceOrderStepHistory } from '@/components/care/ServiceOrderStepHistory';
import { RecordUnavailable } from '@/components/RecordUnavailable';
import { Chip } from '@/components/ui/Chip';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import { ReorderArrows } from '@/components/ui/ReorderArrows';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useConfirm } from '@/hooks/useConfirm';
import { useRouteId } from '@/hooks/useRouteId';
import { useServiceOrderInputDraft } from '@/hooks/useServiceOrderInputDraft';
import { useServiceOrders } from '@/hooks/useServiceOrders';
import {
  isOfflineQueuedError,
  isStaleWriteError,
  isUnreachableWriteError,
} from '@/services/conflictSafeUpdate.client';
import { hydrateServiceOrder, SERVICE_ORDER_STEPS_AGGREGATE } from '@/services/serviceOrders.client';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { textLanguage } from '@/utils/appLocale';
import { namesAPlace, referenceFromTyped, writtenInFor } from '@/utils/bibleLink';
import { newClientId } from '@/utils/clientId';
import { serviceOrderLanguage } from '@/utils/documentLanguage';
import { selectServiceOrderContent } from '@/utils/serviceOrderFreshness';
import { projectServiceOrderStep } from '@/utils/serviceOrderStepPlacement';
import { EMERALD_ACTION, NEUTRAL_CAPTION, CARE_CARD_TONES } from '@/utils/themeColors';
import { useTranslation } from '@locales/useTranslation';

import { ServiceOrderFailure } from '../ReorderArrows';


import type { ServiceOrderInput } from '@/data-engine/react.client';
import type { ServiceOrderStepCapture, ServiceOrderStepVersion } from '@/data-engine/serviceOrderStepAction';
import type { LabeledServiceOrderPlacement } from '@/data-engine/types';
import type { ServiceOrder, ServiceOrderStep } from '@/models/models';
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
  step?: ServiceOrderStepCapture;
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
 * React unmounts the old editor. The engine then captures the remaining text for that
 * service before the new editor opens.
 */
export default function ServiceOrderPage() {
  const orderId = useRouteId(2);
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

/** One read-only rendering for words retained by an open editor or a submitted queue. */
function RetainedOrderSteps({ steps, refsDraft }: { steps: ServiceOrderStep[]; refsDraft: Record<string, string> }) {
  return (
        <ol className="mt-6 flex flex-col gap-5">
          {steps.map((step, index) => (
            <li key={step.id} className="text-sm">
              <p className="font-bold text-gray-900 dark:text-white">
                {index + 1}. <ScriptureText text={step.title} />
              </p>
              {step.body && (
                <p className="mt-1 whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-gray-300">
                  <ScriptureText text={step.body} />
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
  );
}

function ServiceOrderEditor({ orderId }: { orderId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const { confirm, confirmDialog } = useConfirm();
  const { orders, loading, isOnline, updateSteps, stepVersion, captureStepPlacement, shownTitle, recheck, orderPresence, captureTitleTime, titleHistory, deleteOrder } =
    useServiceOrders();
  const inputDraft = useServiceOrderInputDraft(orderId);
  const cachedOrder = orders.find((candidate) => candidate.id === orderId);
  const presence = orderPresence?.(orderId);
  // The copy on screen; it follows the engine row whenever nothing on screen is unsaved (below).
  const [accepted, setAccepted] = useState<{ order: ServiceOrder; stepVersion?: ServiceOrderStepVersion } | null>(null);
  const acceptedOrder = accepted?.order;
  const fromShownOrder = useCallback((shown: ServiceOrder) => ({
    order: shown, stepVersion: stepVersion?.(shown.id, shown.rev?.[SERVICE_ORDER_STEPS_AGGREGATE] ?? 0),
  }), [stepVersion]);
  useEffect(() => {
    if (!acceptedOrder && cachedOrder) setAccepted(fromShownOrder(cachedOrder));
  }, [acceptedOrder, cachedOrder, fromShownOrder]);
  const listOrder = cachedOrder ? acceptedOrder ?? cachedOrder : undefined;
  const nativeSnapshot = inputDraft.latest;
  const nativeVersion = nativeSnapshot?.metadata;
  const listVersion = accepted?.stepVersion;
  const nativeOrder = useMemo(() => {
    if (!listOrder || !nativeVersion || nativeVersion.deleted || !nativeSnapshot?.value
      || (listVersion && (nativeVersion.generation !== listVersion.generation || nativeVersion.revision <= listVersion.observedRevision))) {
      return undefined;
    }
    return hydrateServiceOrder(nativeSnapshot.value as unknown as Omit<ServiceOrder, 'id'>, listOrder.id);
  }, [listOrder, listVersion, nativeSnapshot, nativeVersion]);
  const order = nativeOrder ?? listOrder;
  const confirmContent = (patch: Partial<ServiceOrder>) => {
    setAccepted(current => current ? { ...current, order: { ...current.order, ...patch } } : current);
  };
  /** The current service for a confirmation that stayed open across a change. */
  const orderRef = useRef(order);
  orderRef.current = order;
  /** The rite as it was last seen, for the one screen that has to speak about it once it is gone. */
  const lastKnown = useRef(order);
  if (order) lastKnown.current = order;

  // Keep structural optimism here. The session supplies the editable fields on top of it.
  const [structuralSteps, setStructuralSteps] = useState<ServiceOrderStep[] | null>(null);
  const newSteps = useRef(new Set<string>());
  useEffect(() => {
    if (!Array.isArray(nativeSnapshot?.value?.steps)) return;
    for (const step of nativeSnapshot.value.steps) {
      if (step && typeof step === 'object' && !Array.isArray(step) && typeof step.id === 'string') {
        newSteps.current.delete(step.id);
      }
    }
  }, [nativeSnapshot]);
  const steps = structuralSteps ?? order?.steps ?? lastKnown.current?.steps ?? [];
  const inputs = inputDraft.restored ? [] : inputDraft.inputs;
  const liveSteps = useMemo(() => {
    if (!inputs.length) return steps;
    const byStep = new Map<string, Partial<ServiceOrderStep>>();
    const removed = new Set<string>();
    for (const input of inputs) {
      if (input.field === 'orderTitle') continue;
      if (input.retainedOnly && !input.waitingForStep) removed.add(input.stepId);
      else byStep.set(input.stepId, { ...byStep.get(input.stepId), [input.field]: input.value });
    }
    return steps.filter(step => !removed.has(step.id)).map(step => byStep.has(step.id) ? { ...step, ...byStep.get(step.id) } : step);
  }, [steps, inputs]);
  const structureRef = useRef(steps);
  structureRef.current = steps;
  const liveStepsRef = useRef(liveSteps);
  liveStepsRef.current = liveSteps;

  // An order just created opens ready to be written in: its name is a placeholder, and the first
  // thing its owner wants is to replace it.
  const [editing, setEditing] = useState(searchParams?.get('new') === '1');
  const editingRef = useRef(editing);
  editingRef.current = editing;

  const [session, setSession] = useState(() => newClientId());
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const orderIdRef = useRef(orderId);
  orderIdRef.current = orderId;
  const [failure, setFailure] = useState<FailureWords | null>(null);
  const stageInput = (input: ServiceOrderInput) => {
    void inputDraft.stage(input).catch(error => setFailure(describeFailure(error)));
  };
  const flushInput = (filter?: Parameters<typeof inputDraft.flush>[0]) => {
    if (inputDraft.ready) void inputDraft.flush(filter).catch(error => setFailure(describeFailure(error)));
  };
  const startEditing = () => {
    if (editing) flushInput();
    else setSession(newClientId());
    setEditing(was => !was);
  };

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

  const titleInput = inputs.find(input => input.field === 'orderTitle');
  const titleDraft = titleInput?.raw ?? titleInput?.value ?? null;
  const titleRequired = titleInput?.value === '';
  // The shown local words decide a reference's language, even before delivery or on a retained copy.
  const shownOrder = order ?? lastKnown.current;
  const orderWrittenIn = serviceOrderLanguage(shownOrder ? {
    ...shownOrder,
    title: titleDraft ?? shownOrder.title,
    steps: liveSteps,
  } : null);

  const [verdict, setVerdict] = useState<'checking' | 'absent' | 'unreachable' | null>(null);
  const rechecked = useRef(false);
  const question = useRef(0);
  const recheckRef = useRef(recheck);
  recheckRef.current = recheck;
  const presenceKind = presence?.kind;
  const hasOrder = Boolean(order);
  useEffect(() => () => { question.current += 1; rechecked.current = false; }, []);
  /** The last answer could not reach the server: ask once more when the connection comes back. */
  const unanswered = useRef(false);
  const [askAgain, setAskAgain] = useState(0);
  useEffect(() => {
    if (!isOnline || !unanswered.current) return;
    unanswered.current = false;
    rechecked.current = false;
    setAskAgain(n => n + 1);
  }, [isOnline]);

  useEffect(() => {
    // Asked with or without the icon (owner's rule 3); "absent" needs the server (`recheck`).
    if (hasOrder) {
      question.current += 1;
      rechecked.current = false;
      setVerdict(null);
      return;
    }
    if (presenceKind === 'absent') {
      question.current += 1;
      rechecked.current = true;
      unanswered.current = false;
      setVerdict('absent');
      return;
    }
    if (loading || rechecked.current) return;
    rechecked.current = true;
    setVerdict('checking');
    const currentQuestion = ++question.current;
    /*
     * A read that crossed a write proves nothing either way, so it is simply asked again — a
     * few times, and then the page says "not here yet" rather than inventing a deletion. No
     * timer: each attempt is one question, and the answers run out.
     */
    const ask = async (attemptsLeft: number): Promise<void> => {
      const answer = await recheckRef.current(orderId);
      if (currentQuestion !== question.current) return;
      if (answer === 'overlapped' && attemptsLeft > 0) return ask(attemptsLeft - 1);
      if (answer === 'found') return setVerdict(null);
      if (answer !== 'absent') unanswered.current = true;
      setVerdict(answer === 'overlapped' ? 'unreachable' : answer);
    };
    void ask(2);
  }, [hasOrder, loading, askAgain, presenceKind, orderId]);

  /**
   * A REFUSED WRITE, A QUEUED WRITE AND A CONFLICT ARE THREE DIFFERENT ANSWERS.
   *
   * They used to be one sentence — "could not save" — and that sentence was a lie in two of
   * the three cases: a write queued offline WILL be saved, and a conflict means someone else's
   * version is now on the server, not that the text went nowhere. A person told "failed" about
   * a queued write retypes it; told "failed" about a conflict, he never learns there is
   * another version at all.
   */
  // Words, said when shown: a language switch re-says them (BUG-20261006-screen-error-kept-as-translated-sentence).
  const describeFailure = (error: unknown): FailureWords => {
    console.error('serviceOrder write failed', error);
    if (error instanceof StepGoneError) return { key: 'serviceOrders.stepGone' };
    if (isOfflineQueuedError(error)) return { key: 'serviceOrders.writeQueued' };
    /*
     * Only the sentence belongs here. Taking the server's version as the new baseline is the
     * hook's work — it is the side that serialises the writes, and a baseline kept anywhere else
     * is stale by the time the next one runs.
     */
    if (isStaleWriteError(error) || (error && typeof error === 'object' && 'code' in error && error.code === 'stale-write')) return { key: 'serviceOrders.writeConflict' };
    /*
     * "WE DO NOT KNOW" IS ITS OWN ANSWER, and the most dangerous one to dress up as a refusal.
     * A transaction that times out or loses the connection may already have committed; calling
     * that a refusal and undoing the change on screen turns a saved rite into an unsaved-looking
     * one, and the next edit is then made against a version that no longer exists.
     */
    if (isUnreachableWriteError(error)) return { key: 'serviceOrders.writeUnknown' };
    return { key: 'serviceOrders.writeFailed' };
  };

  /**
   * EVERY FIELD WHOSE LAST WRITE WAS REFUSED, AND WHAT WAS SAID ABOUT IT.
   *
   * Those words exist on this screen and nowhere else. Two things follow, and both were learned
   * the hard way. A later write that SUCCEEDS must not adopt the server's answer over them — it
   * never received the refused sentence, so its truthful answer would wipe the screen clean of
   * the very text the banner was about. And the banner itself must not be cleared by that
   * success: words left on screen with nothing said about them read as saved, and the next
   * reload takes them.
   */
  const unresolved = useRef(new Map<string, Map<string, { said: FailureWords; value?: string }>>());

  const rememberRefusal = useCallback(
    (owner: string, field: string, said: FailureWords, value?: string) => {
      const fields =
        unresolved.current.get(owner) ?? new Map<string, { said: FailureWords; value?: string }>();
      fields.set(field, { said, value });
      unresolved.current.set(owner, fields);
    },
    []
  );

  /** That same field, saved at last. */
  const forgetRefusal = useCallback((owner: string, field: string) => {
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
  const stillUnsaid = useCallback((): FailureWords | null => {
    for (const fields of unresolved.current.values()) {
      for (const entry of fields.values()) return entry.said;
    }
    return null;
  }, []);

  const mirror = useCallback(
    (mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null) => {
      const next = mutate(structureRef.current) ?? structureRef.current;
      structureRef.current = next;
      setStructuralSteps(next);
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
  ): FailureWords => {
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
      const standing = liveStepsRef.current.find((step) => step.id === options.dropOnGone);
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
    if (!unknown && options?.created && structureRef.current.some((step) => step.id === options.created)) {
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
    const sentSteps = structureRef.current;
    try {
      const committed = await (options?.step ? updateSteps(orderId, mutate, options.step) : updateSteps(orderId, mutate));
      const movingStep = options?.step?.field === 'placement';
      if (committed && !movingStep) confirmContent({ steps: selectServiceOrderContent({ steps: committed }).steps });
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
      if (committed && !movingStep) {
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
      if (!committed && !movingStep) return;
      /*
       * Adopted only if nothing newer was typed while this write was in the air. Two fields in a
       * row is an ordinary thing to do: the first write commits what it knew, and taking its
       * answer would lift the newer words off the screen. The write carrying them is already on
       * its way with the truthful one.
       */
      if (structureRef.current !== sentSteps) return;
      // A refused write elsewhere in this rite is still unresolved, and its words are only here.
      if (unresolved.current.size) return;
      /*
       * Nothing is unsaved any more, so the mirror lets go: the hook has just cached exactly
       * these steps, and a screen pinned to a local copy would stop showing anything that
       * happened elsewhere for as long as the tab stayed open.
       */
      if (committed) structureRef.current = committed;
      setStructuralSteps(null);
    } catch (error) {
      setFailure(settleFailure(error, options));
    } finally {
      if (options?.undo) setRearranging(false);
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
  const hasLocalChanges = structuralSteps !== null || inputs.length > 0 || unresolved.current.size > 0 || rearranging;
  // Reading is safe while words are kept here; leaving is offered only after this sitting has no unfinished work.
  const titleHistorySession = titleHistory?.(orderId);
  const canLeaveReading = Boolean(order) && presence?.kind !== 'absent' && presence?.kind !== 'deleting' && !hasLocalChanges;
  const verseWindow = useVerseWindow({ toBible: canLeaveReading });
  /*
   * THE ENGINE ROW IS ALREADY THE ANSWER. Its value is the server's copy plus this device's own
   * submitted work. With nothing unsaved on screen the page follows the row; a new title starts a
   * new sitting, so a rename is judged against the title now on screen.
   */
  useEffect(() => {
    if (!cachedOrder || structuralSteps || rearranging || acceptedOrder === cachedOrder) return;
    setAccepted(fromShownOrder(cachedOrder));
  }, [cachedOrder, structuralSteps, rearranging, acceptedOrder, fromShownOrder]);

  // Both the current and retained reading copy open through the same screen-owned window.
  const reading = (children: ReactNode) => (
    <ScriptureLinks onOpen={verseWindow.open} writtenIn={orderWrittenIn}>
      {children}
      {verseWindow.sheet}
    </ScriptureLinks>
  );

  if (presence?.kind === 'absent' || presence?.kind === 'deleting') {
    const kept = cachedOrder ?? lastKnown.current;
    return reading(<RecordUnavailable presence={presence} onBack={() => router.push('/care/orders')}
      onRetry={() => recheck(orderId)}>
      <ServiceOrderDraftRecovery draft={inputDraft} editing={false} />
      {kept && <section className="space-y-4">
        <h2 className="text-xl font-bold"><ScriptureText text={titleDraft ?? kept.title} /></h2>
        <ServiceOrderFailure message={t(presence.kind === 'absent' ? 'serviceOrders.goneWithWords' : 'recordAvailability.deleting') as string} testId="service-order-gone" />
        <RetainedOrderSteps steps={liveSteps} refsDraft={refsDraft} />
      </section>}
    </RecordUnavailable>);
  }

  if (!order && (structuralSteps || inputs.length > 0 || unresolved.current.size > 0) && lastKnown.current) {
    return reading(
      <div className="mx-auto w-full max-w-3xl">
        <BackToList />

        <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
          <ScriptureText text={titleDraft ?? lastKnown.current.title} />
        </h1>

        <p role="status" className="mt-4 text-sm text-gray-600 dark:text-gray-300">
          {t(verdict === 'absent' ? 'serviceOrders.notFound' : 'recordAvailability.notHereYet')}
        </p>
        <ServiceOrderFailure
          message={t('serviceOrders.goneWithWords') as string}
          testId="service-order-gone"
        />

        <RetainedOrderSteps steps={liveSteps} refsDraft={refsDraft} />
        <ServiceOrderDraftRecovery draft={inputDraft} editing={false} />
      </div>
    );
  }

  /*
    BEING FETCHED IS NOT THE SAME AS NOT BEING THERE, and neither of them is a blank page.
    This screen rendered nothing at all while the read was in the air — invisible on a fast
    machine, and on a tablet with a poor connection a heading over emptiness.
  */
  if ((loading || verdict === 'checking') && verdict !== 'absent' && !order) {
    return (
      <div className="mx-auto w-full max-w-3xl" aria-busy="true" data-testid="service-order-loading">
        <BackToList />
        <div className="mt-6 h-9 w-2/3 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        <div className="mt-7 flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      </div>
    );
  }

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
        <ServiceOrderDraftRecovery draft={inputDraft} editing={false} />
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
    const after = reposition(liveSteps, stepId, toIndex);
    if (!after || from === toIndex) return;
    const change = captureStepPlacement?.(orderId, stepId, liveSteps, after, shownStepVersion());
    return write(
      (steps) => {
        if (!steps.some((step) => step.id === stepId)) throw new StepGoneError();
        return change ? projectServiceOrderStep(steps, stepId, change.placement.destination) ?? null
          : reposition(steps, stepId, toIndex);
      },
      {
        undo: (steps) => reposition(steps, stepId, from),
        dropOnGone: stepId,
        ...(change && { step: { field: 'placement', change } }),
      }
    );
  };

  const restoreStepPlacement = async (gap: LabeledServiceOrderPlacement, stepId: string) => {
    const current = structureRef.current;
    const version = shownStepVersion();
    if ([gap.previous, gap.next].some(anchor => anchor && anchor.generation !== version?.generation)) throw new StepGoneError();
    const projected = projectServiceOrderStep(current, stepId, {
      previous: gap.previous?.id ?? null, next: gap.next?.id ?? null,
    });
    if (!projected) throw new StepGoneError();
    await moveStep(stepId, projected.findIndex(step => step.id === stepId));
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
  const patchStep = (stepId: string, field: string, patch: Partial<ServiceOrderStep>, step?: ServiceOrderStepCapture) =>
    write(
      (steps) => {
        if (!steps.some((step) => step.id === stepId)) throw new StepGoneError();
        return steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
      },
      // Remembered by FIELD, like the timers. Under the step alone, saving that step's heading
      // a moment later cleared the marker its BODY had left, and the refused paragraph was
      // adopted away with it. Kept as a pair rather than a joined string, so a step id that
      // happens to contain a colon cannot be read as belonging to another step.
      { field: { stepId, name: field, value: patchedValue(patch, field) }, step }
    );

  const shownStepVersion = () => nativeOrder && nativeVersion
    ? { generation: nativeVersion.generation, observedRevision: nativeVersion.revision }
    : accepted?.stepVersion ?? fromShownOrder(order).stepVersion;
  const setStepFlag = (step: ServiceOrderStep, flagged: boolean) => {
    const version = shownStepVersion();
    const change = version && { ...version, rowId: step.id, before: Boolean(step.flagged), after: flagged, time: captureTitleTime?.() ?? null };
    return patchStep(step.id, 'flagged', { flagged }, change && { field: 'flagged', change });
  };

  const stepInputScope = (stepId: string) => ({
    stepId, time: captureTitleTime?.() ?? null, version: shownStepVersion(),
    ...(newSteps.current.has(stepId) && { waitingForStep: true as const }),
  });
  const editStepText = (step: ServiceOrderStep, field: 'title' | 'body', text: string) => {
    stageInput({ field, value: text, before: step[field] ?? '', ...stepInputScope(step.id) });
  };
  const restoreStepTitle = async (step: ServiceOrderStep, title: string) => {
    const scope = stepInputScope(step.id);
    if (scope.version?.generation !== titleHistorySession?.generation) throw new StepGoneError();
    await inputDraft.stage({ field: 'title', before: step.title, value: title, ...scope });
    await inputDraft.flush({ field: 'title', stepId: step.id });
  };
  const orderTitleInput = (raw: string): ServiceOrderInput => {
    const seen = nativeOrder && nativeVersion ? {
      generation: nativeVersion.generation, revision: nativeVersion.revision,
    } : shownTitle?.(orderId, { title: order.title, revision: order.rev?.meta ?? 0 });
    const version = seen && { generation: seen.generation, observedRevision: seen.revision,
      ...('requestId' in seen && { requestId: seen.requestId }) };
    return { field: 'orderTitle', value: raw.trim(), raw, before: titleInput?.value ?? order.title,
      version, time: captureTitleTime?.() ?? null };
  };
  const restoreOrderTitle = async (title: string) => {
    const input = orderTitleInput(title);
    if (input.version?.generation !== titleHistorySession?.generation) throw new StepGoneError();
    await inputDraft.stage(input);
    await inputDraft.flush({ field: 'orderTitle' });
  };

  /**
   * The id is minted ONCE, outside the mutator. It used to be created inside, so a write that
   * was retried — which this path deliberately allows — appended a SECOND step instead of
   * repeating the first. Now a replay finds its own step already there and does nothing.
   */
  const addStep = () => {
    const step: ServiceOrderStep = { id: newClientId(), title: '', body: '', scriptureRefs: [] };
    newSteps.current.add(step.id);
    return write((steps) => (steps.some((s) => s.id === step.id) ? null : [...steps, step]), {
      created: step.id,
      undo: (steps) => {
        const standing = liveStepsRef.current.find((entry) => entry.id === step.id) ?? steps.find((entry) => entry.id === step.id);
        if (!standing) return null;
        // Still empty — it was never anything, so it goes. Written into — it stays, because
        // those words exist here and nowhere else.
        const untouched =
          !standing.title && !standing.body && (standing.scriptureRefs ?? []).length === 0;
        return untouched ? steps.filter((entry) => entry.id !== step.id) : null;
      },
    });
  };

  const removeStep = async (stepId: string) => {
    const capturedOrder = orderRef.current;
    const capturedSession = sessionRef.current;
    const capturedStep = liveStepsRef.current.find((step) => step.id === stepId);
    if (!capturedOrder || !capturedStep || !editingRef.current) return;
    const accepted = await confirm({
      title: { key: 'common.deleteItem.title' },
      description: { key: 'common.deleteItem.description' },
      confirmText: { key: 'common.delete' },
      cancelText: { key: 'common.cancel' },
    });
    if (!accepted) return;

    const stillShown = () => {
      const latest = liveStepsRef.current.find(step => step.id === stepId);
      return editingRef.current && orderIdRef.current === capturedOrder.id && orderRef.current?.id === capturedOrder.id
        && orderRef.current.userId === capturedOrder.userId && sessionRef.current === capturedSession && latest
        && ['title', 'body', 'refs', 'flagged'].every(field => fieldValue(latest, field) === fieldValue(capturedStep, field));
    };
    if (!stillShown()) return;

    /*
     * The words go FIRST, even though the step is about to be removed.
     *
     * Cancelling them looked tidy and was a quiet way to lose text: if the removal is then
     * refused, the step comes back on the next read without the sentence that was typed into it,
     * and nothing ever said so. Writes for one service are serialised, so the text lands before
     * the removal and costs nothing when the removal succeeds.
     */
    try {
      if (inputDraft.ready) await inputDraft.flush({ stepId });
    } catch (error) {
      setFailure(describeFailure(error));
      return;
    }
    if (!stillShown()) return;
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
    if (!(await confirm({ title: { key: 'serviceOrders.deleteConfirm' }, confirmText: { key: 'common.delete' } }))) return;
    // Same rule as a removed step: whatever was typed is sent before the document goes, so a
    // refused deletion cannot swallow it.
    try {
      if (inputDraft.ready) await inputDraft.flush();
      await deleteOrder(orderId);
      router.push('/care/orders');
    } catch (error) {
      setFailure(describeFailure(error));
    }
  };

  return reading(
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
              key={session}
              value={titleDraft ?? order.title}
              aria-label={t('serviceOrders.orderTitle') as string}
              disabled={!inputDraft.ready}
              onChange={event => stageInput(orderTitleInput(event.target.value))}
              onBlur={() => flushInput({ field: 'orderTitle' })}
              className="min-w-0 flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-2xl font-extrabold tracking-tight text-gray-900 focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          ) : (
            <h1 className="min-w-0 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl dark:text-white">
              <ScriptureText text={titleInput?.value || order.title} />
            </h1>
          )}

          <button
            type="button"
            onClick={startEditing}
            className={`inline-flex shrink-0 items-center rounded-full px-5 py-2.5 text-sm font-bold transition ${
              editing
                ? EMERALD_ACTION
                : 'border border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
            }`}
          >
            {editing ? t('serviceOrders.done') : t('serviceOrders.edit')}
          </button>
        </div>

        {titleHistorySession && <DocumentFieldHistory key={JSON.stringify([titleHistorySession.owner, orderId, titleHistorySession.generation])}
          session={{ ...titleHistorySession, restore: restoreOrderTitle }} current={titleDraft ?? order.title}
          disabled={!inputDraft.ready || hasLocalChanges || editing} />}
        {titleHistorySession && <>
          <ServiceOrderPlacementHistory
            key={JSON.stringify([titleHistorySession.owner, orderId, titleHistorySession.generation, 'position'])}
            step session={{ ...titleHistorySession, restore: restoreStepPlacement }} disabled={hasLocalChanges || editing} />
          <ServiceOrderStepHistory
            key={JSON.stringify([titleHistorySession.owner, orderId, titleHistorySession.generation, 'flagged'])}
            owner={titleHistorySession.owner} orderId={orderId} generation={titleHistorySession.generation}
            steps={liveSteps} disabled={hasLocalChanges || editing} field="flagged" onRestore={setStepFlag} />
          <ServiceOrderStepHistory
            key={JSON.stringify([titleHistorySession.owner, orderId, titleHistorySession.generation, 'title'])}
            owner={titleHistorySession.owner} orderId={orderId} generation={titleHistorySession.generation}
            steps={liveSteps} disabled={!inputDraft.ready || hasLocalChanges || editing} field="title" onRestore={restoreStepTitle} />
        </>}

        {order.summary && !editing && (
          <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
            <ScriptureText text={order.summary} />
          </p>
        )}
      </header>

      <ServiceOrderDraftRecovery draft={inputDraft} editing={editing} />
      {(failure || titleRequired) && <ServiceOrderFailure
        message={failure ? sayFailure(failure, t) : t('serviceOrders.titleRequired') as string} testId="service-order-failure" />}

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
                      disabled={!inputDraft.ready}
                      onChange={(event) => editStepText(step, 'title', event.target.value)}
                      onBlur={() => flushInput({ stepId: step.id, field: 'title' })}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-900 focus:border-emerald-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
                    />
                    <textarea
                      value={step.body ?? ''}
                      rows={3}
                      placeholder={t('serviceOrders.stepWords') as string}
                      aria-label={t('serviceOrders.stepWords') as string}
                      disabled={!inputDraft.ready}
                      onChange={(event) => editStepText(step, 'body', event.target.value)}
                      onBlur={() => flushInput({ stepId: step.id, field: 'body' })}
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
                      disabled={!inputDraft.ready}
                      onChange={(event) => {
                        const raw = event.target.value;
                        setRefsDraft(drafts => ({ ...drafts, [step.id]: raw }));
                        stageInput({ field: 'scriptureRefs', value: parseRefs(raw), raw, before: step.scriptureRefs ?? [],
                          ...stepInputScope(step.id) });
                      }}
                      onBlur={() => {
                        flushInput({ stepId: step.id, field: 'scriptureRefs' });
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
                        onClick={() => setStepFlag(step, !step.flagged)}
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
                        className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-gray-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-bold tracking-tight text-gray-900 dark:text-gray-100">
                        <ScriptureText text={step.title} />
                      </span>
                      {step.flagged && (
                        <Chip tone="amber" size="xs" weight="bold">
                          {t('serviceOrders.flag')}
                        </Chip>
                      )}
                    </div>

                    {step.body ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                        <ScriptureText text={step.body} />
                      </p>
                    ) : (
                      // Says the words are missing rather than showing a specimen he could
                      // read out by accident. The app never supplies wording here.
                      <p className={`mt-1 text-sm ${NEUTRAL_CAPTION}`}>
                        {t('serviceOrders.stepEmpty')}
                      </p>
                    )}

                    {(step.scriptureRefs ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(step.scriptureRefs ?? []).map((ref) => {
                          // A reference the app can read — a whole book, or a chapter and verse it has — opens over the order;
                          // any other ("Рим 25") stays a label. Its Bible is the
                          // one its words were written in: the order's, else the step's (`referenceFromTyped`).
                          const written = orderWrittenIn ?? textLanguage(`${step.title}\n${step.body ?? ''}`);
                          const reference = referenceFromTyped(ref, { locale, written });
                          const writtenIn = reference ? writtenInFor(ref, reference, locale) : undefined;
                          return (
                            <span key={ref} className="inline-flex items-center">
                              <Chip tone="emerald" size="xs" weight="bold" onClick={reference && (!reference.chapter || namesAPlace(reference)) ? () => verseWindow.open(reference) : undefined}>
                                {ref}
                              </Chip>
                              {writtenIn ? <WrittenInMark bible={writtenIn} /> : null}
                            </span>
                          );
                        })}
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
      {confirmDialog}
    </div>
  );
}
