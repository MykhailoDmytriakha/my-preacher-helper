'use client';

import {
  ArrowPathIcon,
  BookOpenIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  InformationCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { createSermon } from '@/services/sermon.service';
import {
  cutStudyNoteIntoScratch,
  CutStudyNoteError,
  fetchNoteCutOutline,
  type CutStudyNoteResponse,
  type NoteCutOutline,
} from '@/services/studies.service';
import { newClientId } from '@/utils/clientId';
import { measureNoteForCut, WORDS_PER_CLAIM_HIGH, WORDS_PER_CLAIM_LOW } from '@/utils/noteCutCorridor';
import { sermonDetailKey, sermonListKey } from '@/utils/queryKeys';
import { NOTE_TO_SERMON_COLORS } from '@/utils/themeColors';

import { formatScriptureRef } from '../bookAbbreviations';

import type { BibleLocale } from '../bibleData';
import type { ScriptureReference, Sermon } from '@/models/models';

/**
 * A SERMON IS BORN FROM A NOTE — in the open, step by step.
 *
 * What the person sees before pressing anything is exactly what will happen: the title
 * and Scripture the sermon will carry (both editable), how many scratch notes to expect
 * and WHY that many, and where they will land. What they see after pressing is the same
 * list of steps turning green one by one, so a wait of half a minute is never a blank
 * spinner. And when it is done the dialog STAYS: it shows what was made — how many
 * scratch notes, which passage became the verse — and hands over one button to open the
 * sermon. Jumping away on completion had taken that information with it.
 *
 * The order of the steps is the order that keeps failure harmless: the note is cut
 * FIRST and nothing is written until the cut succeeded, so a refused or failed cut leaves
 * no half-born sermon behind. When the create fails after a good cut, the atoms are kept
 * in memory and "Try again" repeats only the write — the model is not paid twice.
 *
 * THE SERMON'S ID IS MINTED ONCE, when the dialog opens, and every attempt uses it. The
 * create route is idempotent by client id, so a write whose answer was lost — the tab
 * closed, the connection dropped after the server committed — cannot produce a second
 * sermon on retry: the server answers the one it already has.
 *
 * The note is read on the server as it was last saved: this dialog never uploads editor
 * text, so the cut is of the note that exists, not of an unsaved draft. The opener holds
 * the door while the note has unsaved edits, for the same reason.
 */
/**
 * THE STEPS ARE THE WORK, not a decoration of it.
 *
 * The cut of a long note is several requests, and the person watches them go by: first
 * the note is read and divided (no model, under a second), then one step per slice of
 * sections, then the sermon is written. A slice that fails is retried alone — the slices
 * already cut are kept, so a provider hiccup at the third of four costs one request, not
 * the whole minute.
 */
const PLAN_STEP = 'plan';
const CREATE_STEP = 'create';
const cutStepId = (index: number) => `cut:${index}`;
type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface PlannedStep {
  id: string;
  label: string;
}
type Phase = 'form' | 'running' | 'error' | 'done';

/**
 * The cut route refuses notes above 60,000 characters; this is that ceiling said in
 * WORDS, rounded down to thousands, because the refusal is read by a person and
 * "60,000 characters" tells them nothing about the note in front of them. Deliberately
 * understated: a note that squeaks past the limit is a happy surprise, a note refused
 * below the promised size is a broken promise.
 */
export const MAX_CUT_WORDS_THOUSANDS = 9;

export interface CreateSermonFromNoteModalProps {
  noteId: string;
  noteTitle: string;
  scriptureRefs: ScriptureReference[];
  /** The note's text. Measured here only to say what to expect — never uploaded. */
  noteContent: string;
  onClose: () => void;
  /** The control that opened the dialog; focus returns to it on close. */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

function toBibleLocale(language: string | undefined): BibleLocale {
  const lang = language?.toLowerCase() || 'en';
  if (lang.startsWith('ru')) return 'ru';
  if (lang.startsWith('uk')) return 'uk';
  return 'en';
}

/**
 * The most specific reference the author attached — a verse beats a chapter beats a
 * chapter range beats a book. A chapter range is stored with `fromVerse: 1` on this
 * app's notes, so "has a verse" alone would pick "1 Chr 1-9" over "1 Chr 4:9-10"; the
 * range is recognised by its `toChapter` and formatted as a range, not as verse 1.
 */
export function pickVerseFromRefs(refs: ScriptureReference[], locale: BibleLocale): string {
  if (!refs || refs.length === 0) return '';
  const isRange = (ref: ScriptureReference) => typeof ref.toChapter === 'number' && ref.toChapter !== ref.chapter;
  const hasVerse = (ref: ScriptureReference) => typeof ref.fromVerse === 'number' && ref.fromVerse > 0;
  const hasChapter = (ref: ScriptureReference) => typeof ref.chapter === 'number' && ref.chapter > 0;
  const chosen =
    refs.find((ref) => hasVerse(ref) && !isRange(ref)) ??
    refs.find((ref) => hasChapter(ref) && !isRange(ref)) ??
    refs.find(isRange) ??
    refs[0];
  const printable = isRange(chosen) ? { ...chosen, fromVerse: undefined, toVerse: undefined } : chosen;
  return formatScriptureRef(printable, locale);
}

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Thrown when the cut left the sermon without any Scripture to be born with. */
class VerseMissingAfterCutError extends Error {
  constructor() {
    super('No verse after cut');
    this.name = 'VerseMissingAfterCutError';
  }
}

/**
 * A ONE-LINE FIELD THAT WRAPS INSTEAD OF SCROLLING AWAY.
 *
 * A title and a verse are one line of text by nature, but not by length: a person who
 * pastes the whole verse into "Scripture" got a box scrolled to its tail — the beginning
 * of their own text was off-screen and there was no hint that anything was missing. So
 * the field is a textarea that grows to fit what is in it and stops at a few lines, while
 * behaving like an input in every way that matters: no newlines in the value, no resize
 * handle, and Enter submits the dialog rather than breaking the line.
 */
interface GrowingFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  fieldRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}

function GrowingField({ id, value, onChange, placeholder, disabled, className, fieldRef }: GrowingFieldProps) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const attach = useCallback(
    (node: HTMLTextAreaElement | null) => {
      localRef.current = node;
      if (fieldRef) fieldRef.current = node;
    },
    [fieldRef]
  );

  // Height follows the content on every change, including the value arriving from the
  // outside — the key passage the cutter found replaces the verse without anyone typing.
  useLayoutEffect(() => {
    const field = localRef.current;
    if (!field) return;
    field.style.height = 'auto';
    // `box-sizing: border-box` means the height set here INCLUDES the borders, while
    // scrollHeight does not: without adding them back the box is two pixels short and the
    // last line can still be scrolled a little, which is exactly the defect being fixed.
    const borders = field.offsetHeight - field.clientHeight;
    if (field.scrollHeight > 0) field.style.height = `${field.scrollHeight + borders}px`;
  }, [value]);

  return (
    <textarea
      ref={attach}
      id={id}
      rows={1}
      value={value}
      // A pasted line break would travel into the sermon's own title; it is folded into a
      // space here, where the person can still see what happened.
      onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const form = event.currentTarget.form;
        if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
      }}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
    />
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function CreateSermonFromNoteModal({
  noteId,
  noteTitle,
  scriptureRefs,
  noteContent,
  onClose,
  returnFocusTo,
}: CreateSermonFromNoteModalProps) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { uid } = useResolvedUid();

  const bibleLocale = useMemo(() => toBibleLocale(i18n.language), [i18n.language]);
  /**
   * WHAT THE NOTE IS, IN UNITS THE READER CAN CHECK. Words and paragraphs, never
   * characters: "36,719 characters" is a number nobody can picture, and the corridor
   * derived from it could not be explained without arithmetic the person cannot follow.
   */
  const measure = useMemo(() => measureNoteForCut(noteContent), [noteContent]);
  const corridor = measure.corridor;
  const noteIsEmpty = measure.words <= 0;
  const formatNumber = useCallback(
    (value: number) => {
      try {
        return value.toLocaleString(i18n.language || 'en');
      } catch {
        return String(value);
      }
    },
    [i18n.language],
  );
  /** Above a thousand the exact word count is false precision — round it to the hundred. */
  const roundedWords = measure.words >= 1000 ? Math.round(measure.words / 100) * 100 : measure.words;
  const wordsLabel = t('studiesWorkspace.createSermon.measureWords', {
    count: roundedWords,
    formatted: formatNumber(roundedWords),
  });
  const paragraphsLabel = t('studiesWorkspace.createSermon.measureParagraphs', {
    count: measure.paragraphs,
    formatted: formatNumber(measure.paragraphs),
  });
  /**
   * The same rate said in paragraphs — the unit the reader is actually looking at. It is
   * DERIVED from this note, never asserted: "one thought per one or two dense paragraphs"
   * sounded right and was wrong by a factor of four on a note whose paragraphs run short.
   * Below two paragraphs per scratch note the ratio stops meaning anything, and then the
   * sentence is simply not said.
   */
  const paragraphRate = useMemo(() => {
    const { paragraphs } = measure;
    const { min, max } = corridor;
    if (min <= 0 || paragraphs < max * 2) return null;
    const from = Math.max(1, Math.floor(paragraphs / max));
    const to = Math.max(from + 1, Math.round(paragraphs / min));
    return { from, to };
  }, [measure, corridor]);

  const [title, setTitle] = useState(() => noteTitle.trim() || t('studiesWorkspace.untitled'));
  const [verse, setVerse] = useState(() => pickVerseFromRefs(scriptureRefs, bibleLocale));
  /**
   * Whether the person edited the verse. The prefill is only a guess from the attached
   * references; the cutter, having read the whole note, names its key passage — and that
   * replaces the guess, but never a verse the person typed themselves.
   */
  const [verseTouched, setVerseTouched] = useState(false);
  const [appliedKeyPassage, setAppliedKeyPassage] = useState<string | null>(null);
  /**
   * The reasoning behind the expected count, folded away. It answers "why that many and
   * how was it counted" — worth an honest answer, not worth the room it takes for the
   * person who already trusts the number, so it opens on a click and not on hover: a
   * hover-only explanation does not exist on a phone.
   */
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [steps, setSteps] = useState<Record<string, StepStatus>>({});
  const [error, setError] = useState<string | null>(null);
  /**
   * The plan of the cut and what each slice answered. Kept in refs as well as in state:
   * the run reads them inside an async loop that outlives several renders, and a retry
   * must see what is already cut rather than pay for it again.
   */
  const [outline, setOutline] = useState<NoteCutOutline | null>(null);
  const outlineRef = useRef<NoteCutOutline | null>(null);
  const [sliceResults, setSliceResults] = useState<(CutStudyNoteResponse | null)[]>([]);
  const sliceResultsRef = useRef<(CutStudyNoteResponse | null)[]>([]);
  const [bornSermonId, setBornSermonId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const stepsRef = useRef<HTMLOListElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);
  const aliveRef = useRef(true);
  /** Minted once per dialog; every create attempt reuses it (see the header comment). */
  const sermonIdRef = useRef<string>(newClientId());

  const busy = phase === 'running';
  const offline = isBrowserOffline();
  const canCreate = !busy && !offline && !noteIsEmpty && title.trim().length > 0;

  useEffect(() => {
    setMounted(true);
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [mounted]);

  /**
   * Focus follows the phase: while the steps run every input and the submit are disabled,
   * so the step list takes focus; when it is done, the one thing left to do is the button
   * that opens the sermon. Neither element exists before its phase has rendered, hence an
   * effect and not a call in the handler.
   */
  useEffect(() => {
    if (phase === 'running') stepsRef.current?.focus();
    if (phase === 'done') openButtonRef.current?.focus();
  }, [phase]);

  /**
   * Closing is always allowed. While the cut runs the server writes nothing, and once the
   * create has started its id is fixed, so the sermon that may still be born is the same
   * one a retry would answer — there is nothing here a person can be trapped into.
   */
  const close = useCallback(() => {
    onClose();
    const opener = returnFocusTo?.current;
    if (opener && typeof opener.focus === 'function' && !opener.hasAttribute('disabled')) opener.focus();
  }, [onClose, returnFocusTo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const setStep = (key: string, status: StepStatus) => {
    if (!aliveRef.current) return;
    setSteps((previous) => ({ ...previous, [key]: status }));
  };

  /** Every scratch note cut so far, in reading order — slices are cut in order. */
  const collectedNotes = useMemo(
    () => sliceResults.flatMap((slice) => slice?.notes ?? []),
    [sliceResults]
  );

  /**
   * The steps the person sees. Before the note has been read there is one cut step, a
   * promise of "this will be cut"; once the plan is known it becomes one step per slice,
   * named by the sections it covers, so the progress is in the author's own map of the note.
   */
  const plannedSteps = useMemo<PlannedStep[]>(() => {
    const list: PlannedStep[] = [{ id: PLAN_STEP, label: t('studiesWorkspace.createSermon.steps.plan') }];
    const slices = outline?.slices ?? [];
    if (slices.length > 1) {
      slices.forEach((slice, index) => {
        list.push({
          id: cutStepId(index),
          label: t('studiesWorkspace.createSermon.steps.cutSlice', {
            from: slice.offset + 1,
            to: slice.offset + slice.limit,
            total: outline?.totalSections ?? slice.offset + slice.limit,
          }),
        });
      });
    } else {
      list.push({ id: cutStepId(0), label: t('studiesWorkspace.createSermon.steps.cut') });
    }
    list.push({ id: CREATE_STEP, label: t('studiesWorkspace.createSermon.steps.create') });
    return list;
  }, [outline, t]);

  const errorMessageFor = (step: string, cause: unknown): string => {
    if (cause instanceof VerseMissingAfterCutError) return t('studiesWorkspace.createSermon.errors.verseRequired');
    if (cause instanceof CutStudyNoteError) {
      if (cause.usageCap) return t('studiesWorkspace.createSermon.errors.usageCap');
      if (cause.status === 400) return t('studiesWorkspace.createSermon.errors.empty');
      if (cause.status === 413) return t('studiesWorkspace.createSermon.errors.noteTooLong', { limit: MAX_CUT_WORDS_THOUSANDS });
      if (cause.status === 422) return t('studiesWorkspace.createSermon.errors.nothingCut');
    }
    if (step === PLAN_STEP) return t('studiesWorkspace.createSermon.errors.planFailed');
    if (step !== CREATE_STEP) return t('studiesWorkspace.createSermon.errors.cutFailed');
    return t('studiesWorkspace.createSermon.errors.createFailed');
  };

  /**
   * Runs the whole thing from wherever it actually stands. There is no "start from step
   * N" argument on purpose: what is already done is what is already in hand — the plan in
   * `outlineRef`, each answered slice in `sliceResultsRef` — so pressing "Try again"
   * resumes at the first piece of work that has no result, and never pays twice.
   */
  const run = async () => {
    if (!uid) return;
    const cleanTitle = title.trim();
    const cleanVerse = verse.trim();
    if (!cleanTitle) {
      setError(t('studiesWorkspace.createSermon.errors.titleRequired'));
      return;
    }
    if (isBrowserOffline()) {
      setError(t('studiesWorkspace.createSermon.errors.offline'));
      return;
    }

    setPhase('running');
    setError(null);

    let current = PLAN_STEP;
    try {
      let plan = outlineRef.current;
      if (!plan) {
        setStep(PLAN_STEP, 'running');
        plan = await fetchNoteCutOutline(noteId);
        if (!aliveRef.current) return;
        outlineRef.current = plan;
        setOutline(plan);
      }
      setStep(PLAN_STEP, 'done');

      const results = [...sliceResultsRef.current];
      results.length = plan.slices.length;
      for (let index = 0; index < plan.slices.length; index += 1) {
        current = cutStepId(index);
        if (results[index]) {
          setStep(current, 'done');
          continue;
        }
        setStep(current, 'running');
        const answer = await cutStudyNoteIntoScratch(noteId, plan.slices[index]);
        if (!aliveRef.current) return;
        results[index] = answer;
        sliceResultsRef.current = results;
        setSliceResults([...results]);
        setStep(current, 'done');
      }

      const notes = results.flatMap((slice) => slice?.notes ?? []);
      if (notes.length === 0) throw new CutStudyNoteError('The cut answered without usable scratch notes', 422);

      // The verse: what the person typed wins; otherwise the cutter's key passage, which
      // the server has already checked against the note; otherwise the guessed prefill.
      // With several slices the first slice that named one wins — it read the opening,
      // where a note says what it is about.
      const keyPassage = (results.find((slice) => slice?.keyPassage.trim())?.keyPassage ?? '').trim();
      let verseForSermon = cleanVerse;
      if (keyPassage && (!verseTouched || !cleanVerse) && keyPassage !== cleanVerse) {
        verseForSermon = keyPassage;
        setVerse(keyPassage);
        setAppliedKeyPassage(keyPassage);
      }
      current = CREATE_STEP;
      if (!verseForSermon) throw new VerseMissingAfterCutError();

      setStep(CREATE_STEP, 'running');
      const sermon: Sermon = await createSermon({
        id: sermonIdRef.current,
        title: cleanTitle,
        verse: verseForSermon,
        date: new Date().toISOString(),
        thoughts: [],
        userId: uid,
        sourceNoteIds: [noteId],
        scratch: notes,
      });
      if (!aliveRef.current) return;

      // Seed what the next screen reads, so it opens with the sermon instead of a blank
      // detail fetch. A list fetch already in flight would land after the patch and erase
      // it, so it is cancelled first; the list is only patched when it is already cached —
      // seeding an absent list would make the sermons page show one sermon until it refetched.
      await queryClient.cancelQueries({ queryKey: sermonListKey(uid) });
      queryClient.setQueryData<Sermon>(sermonDetailKey(uid, sermon.id), sermon);
      queryClient.setQueryData<Sermon[] | undefined>(sermonListKey(uid), (old) =>
        old ? [sermon, ...old.filter((item) => item.id !== sermon.id)] : old
      );
      void queryClient.invalidateQueries({ queryKey: sermonListKey(uid), refetchType: 'none' });
      setStep(CREATE_STEP, 'done');
      setBornSermonId(sermon.id);
      setPhase('done');
    } catch (cause) {
      if (!aliveRef.current) return;
      console.error('CreateSermonFromNote: step failed', current, cause);
      setStep(current, 'error');
      setError(errorMessageFor(current, cause));
      setPhase('error');
    }
  };

  const openSermon = () => {
    if (!bornSermonId) return;
    router.push(`/sermons/${bornSermonId}?mode=raw`);
  };

  const stepIcon = (status: StepStatus) => {
    const base = 'h-5 w-5 shrink-0';
    if (status === 'done') return <CheckCircleIcon className={`${base} ${NOTE_TO_SERMON_COLORS.stepDone}`} aria-hidden="true" />;
    if (status === 'running')
      return <ArrowPathIcon className={`${base} animate-spin ${NOTE_TO_SERMON_COLORS.stepRunning}`} aria-hidden="true" />;
    if (status === 'error')
      return <ExclamationCircleIcon className={`${base} ${NOTE_TO_SERMON_COLORS.stepError}`} aria-hidden="true" />;
    return (
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center ${NOTE_TO_SERMON_COLORS.stepPending}`}
        aria-hidden="true"
      >
        <span className="h-2.5 w-2.5 rounded-full border-2 border-current" />
      </span>
    );
  };

  const showSteps = phase !== 'form';
  const done = phase === 'done' && collectedNotes.length > 0;
  const inputClass = `block w-full resize-none overflow-y-auto rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${NOTE_TO_SERMON_COLORS.inputFocus} max-h-32`;
  const formHint = noteIsEmpty
    ? t('studiesWorkspace.createSermon.errors.empty')
    : offline
      ? t('studiesWorkspace.createSermon.errors.offline')
      : error;

  const content = (
    <div className="fixed inset-0 z-[100] flex bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="create-sermon-from-note-title"
        data-testid="create-sermon-from-note-modal"
        className="flex h-full w-full flex-col overflow-hidden border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800 sm:h-auto sm:max-h-[85vh] sm:max-w-xl sm:rounded-2xl sm:border"
      >
        {/* The accent bar follows the dialog's own corners, so it ends with the card instead of being sliced by it. */}
        <div className={`h-1 w-full shrink-0 sm:rounded-t-2xl ${NOTE_TO_SERMON_COLORS.dialogAccentBar}`} />
        <div className="flex flex-1 flex-col overflow-y-auto p-5 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${NOTE_TO_SERMON_COLORS.dialogEyebrow}`}>
                <BookOpenIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t('studiesWorkspace.createSermon.eyebrow')}
              </p>
              <h2 id="create-sermon-from-note-title" className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">
                {t('studiesWorkspace.createSermon.title')}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('studiesWorkspace.createSermon.description')}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={t('studiesWorkspace.createSermon.close')}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canCreate && phase === 'form') void run();
            }}
          >
            <div>
              <label htmlFor="create-sermon-title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('studiesWorkspace.createSermon.titleLabel')}
              </label>
              <GrowingField
                fieldRef={titleRef}
                id="create-sermon-title"
                value={title}
                onChange={setTitle}
                placeholder={t('studiesWorkspace.createSermon.titlePlaceholder')}
                disabled={busy || done}
                className={`mt-1.5 ${inputClass}`}
              />
            </div>
            <div>
              <label htmlFor="create-sermon-verse" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                {t('studiesWorkspace.createSermon.verseLabel')}
              </label>
              <GrowingField
                id="create-sermon-verse"
                value={verse}
                onChange={(next) => {
                  setVerse(next);
                  setVerseTouched(true);
                }}
                placeholder={t('studiesWorkspace.createSermon.versePlaceholder')}
                disabled={busy || done}
                className={`mt-1.5 ${inputClass}`}
              />
              {!showSteps && (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('studiesWorkspace.createSermon.verseHint')}
                </p>
              )}
            </div>

            {!showSteps && !noteIsEmpty && (
              <div className={`rounded-xl px-3.5 py-3 text-sm ${NOTE_TO_SERMON_COLORS.expectation}`} data-testid="create-sermon-expectation">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1">
                    {t('studiesWorkspace.createSermon.expected', {
                      count: corridor.max,
                      min: corridor.min,
                      max: corridor.max,
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setExplainerOpen((open) => !open)}
                    aria-expanded={explainerOpen}
                    aria-controls="create-sermon-expectation-explainer"
                    aria-label={t('studiesWorkspace.createSermon.explainToggle')}
                    title={t('studiesWorkspace.createSermon.explainToggle')}
                    data-testid="create-sermon-expectation-info"
                    className="-mr-1 -mt-0.5 shrink-0 rounded-full p-1 opacity-60 transition hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-700"
                  >
                    <InformationCircleIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <p className="mt-1 text-xs opacity-80">
                  {t('studiesWorkspace.createSermon.measureLine', {
                    title: noteTitle.trim() || t('studiesWorkspace.untitled'),
                    paragraphs: paragraphsLabel,
                    words: wordsLabel,
                  })}
                </p>
                {explainerOpen && (
                  <div
                    id="create-sermon-expectation-explainer"
                    data-testid="create-sermon-expectation-explainer"
                    className={`mt-2.5 space-y-1.5 border-t pt-2.5 text-xs leading-relaxed opacity-90 ${NOTE_TO_SERMON_COLORS.expectationDivider}`}
                  >
                    <p>{t('studiesWorkspace.createSermon.explainWhat')}</p>
                    <p>
                      {t('studiesWorkspace.createSermon.explainHow', {
                        from: WORDS_PER_CLAIM_HIGH,
                        to: WORDS_PER_CLAIM_LOW,
                      })}
                    </p>
                    <p>
                      {paragraphRate
                        ? t('studiesWorkspace.createSermon.explainHereWithRate', {
                            paragraphs: paragraphsLabel,
                            words: wordsLabel,
                            rate: t('studiesWorkspace.createSermon.explainRateParagraphs', {
                              count: paragraphRate.to,
                              from: paragraphRate.from,
                              to: paragraphRate.to,
                            }),
                            min: corridor.min,
                            max: corridor.max,
                          })
                        : t('studiesWorkspace.createSermon.explainHere', {
                            paragraphs: paragraphsLabel,
                            words: wordsLabel,
                            min: corridor.min,
                            max: corridor.max,
                          })}
                    </p>
                  </div>
                )}
              </div>
            )}

            {showSteps && (
              <ol
                ref={stepsRef}
                tabIndex={-1}
                className="space-y-2.5 rounded-xl border border-gray-200 p-3.5 outline-none dark:border-gray-700"
                aria-live="polite"
                data-testid="create-sermon-steps"
              >
                {plannedSteps.map((step) => {
                  const status = steps[step.id] ?? 'pending';
                  const sliceIndex = step.id.startsWith('cut:') ? Number(step.id.slice(4)) : -1;
                  const cutOfThisStep = sliceIndex >= 0 ? sliceResults[sliceIndex] : null;
                  const tone =
                    status === 'pending'
                      ? 'text-gray-400 dark:text-gray-500'
                      : status === 'error'
                        ? 'text-red-700 dark:text-red-300'
                        : 'text-gray-900 dark:text-gray-100';
                  return (
                    <li
                      key={step.id}
                      className={`flex items-start gap-3 text-sm ${tone}`}
                      data-testid={`create-sermon-step-${step.id}`}
                      data-status={status}
                    >
                      {stepIcon(status)}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{step.label}</p>
                        {status === 'done' && cutOfThisStep && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {t('studiesWorkspace.createSermon.cutDone', { count: cutOfThisStep.notes.length })}
                            {sliceIndex === 0 && appliedKeyPassage && (
                              <span className="block" data-testid="create-sermon-key-passage">
                                {t('studiesWorkspace.createSermon.keyPassageApplied', { passage: appliedKeyPassage })}
                              </span>
                            )}
                          </p>
                        )}
                        {status === 'error' && error && (
                          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {done && (
              <div
                className={`rounded-xl px-3.5 py-3 text-sm ${NOTE_TO_SERMON_COLORS.expectation}`}
                role="status"
                data-testid="create-sermon-done"
              >
                <p className="font-medium">{t('studiesWorkspace.createSermon.success', { count: collectedNotes.length })}</p>
                <p className="mt-1 text-xs opacity-80">{t('studiesWorkspace.createSermon.doneHint')}</p>
              </div>
            )}

            {!showSteps && formHint && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {formHint}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {phase === 'form' ? t('studiesWorkspace.createSermon.cancel') : t('studiesWorkspace.createSermon.close')}
              </button>
              {phase === 'error' && (
                <button
                  type="button"
                  onClick={() => void run()}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${NOTE_TO_SERMON_COLORS.primaryButton}`}
                >
                  {t('studiesWorkspace.createSermon.retry')}
                </button>
              )}
              {done && (
                <button
                  ref={openButtonRef}
                  type="button"
                  onClick={openSermon}
                  data-testid="create-sermon-open"
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${NOTE_TO_SERMON_COLORS.primaryButton}`}
                >
                  {t('studiesWorkspace.createSermon.openScratch')}
                </button>
              )}
              {(phase === 'form' || phase === 'running') && (
                <button
                  type="submit"
                  disabled={!canCreate}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${NOTE_TO_SERMON_COLORS.primaryButton}`}
                >
                  {t('studiesWorkspace.createSermon.create')}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}
