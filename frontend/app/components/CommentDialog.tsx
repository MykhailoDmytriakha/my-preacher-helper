'use client';

import { RectangleStackIcon } from '@heroicons/react/20/solid';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import { paragraphPlaceRefusal, storedCommentLayout } from '@/components/bible/commentParagraphPlacement';
import { CommentPlaceShown, MovePlaceButton, useCommentPlace } from '@/components/CommentPlaceMove';
import { CommentIcon, ParagraphIcon } from '@/components/Icons';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { DocumentFieldHistory } from '@/components/ui/DocumentFieldHistory';
import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { UnsavedDraftOffer } from '@/components/UnsavedDraftOffer';
import { useConfirm, useDiscardQuestion } from '@/hooks/useConfirm';
import { useDraftQuestion, useDurableDraft, useSettleShownDraft } from '@/hooks/useDurableDraft';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { NOTE_AGGREGATE } from '@/services/studies.service';
import { sayFailure, type FailureWords } from '@/utils/actionFailureMessage';
import { resolveAppLocale } from '@/utils/appLocale';
import { newClientId } from '@/utils/clientId';
import { COMMENT_DRAFT_AGGREGATE, commentDraftDocument, commentDraftReference, commentDraftValue, findCommentDraftCopies, isCommentDraftSaved, type CommentDraft, type CommentDraftTarget, type RestoredCommentPlace } from '@/utils/commentDrafts';
import { COMMENT_SENTENCES, measureComment } from '@/utils/commentLength';
import { referenceBibleFor } from '@/utils/scriptureReferenceNumbering';
import { useTranslation } from '@locales/useTranslation';

import type { ScriptureReference, StudyNote, StudyNoteType } from '@/models/models';
import type { BibleId } from '@/utils/bibles';

/** Public reader/list target; storage identity belongs to the comment draft adapter. */
export type CommentTarget = CommentDraftTarget;

/** A study note stored without a type is a note — the engine's rule (`useStudyNotesEngine`, `storedField`), one for every screen. */
const NO_TYPE: StudyNoteType = 'note';

/** What another device stored, for every field this window compares. */
type StoredVersion = { revision: number; content: string; type: StudyNoteType; title: string; scriptureRefs: ScriptureReference[] | null; paragraph: boolean | undefined; reported: string[] };

/**
 * WHAT A SAVE OF A WRITTEN COMMENT WRITES: only the fields this window changed, each guarded by the value it opened with.
 * An action changes what it changes (the owner's model): a comment moved here while its words were edited on another device
 * keeps those words — sending the old words along would be refused, or written over them on «keep mine» (Codex review,
 * 2026-10-28).
 */
function changesOf(
  { mine, guard }: { mine: StudyNote; guard: StudyNote },
  fields: { content: string; type: StudyNoteType; title?: string; paragraph?: boolean },
  placing: { updates: Partial<StudyNote>; baseline: Record<string, unknown> },
): { updates: Partial<StudyNote>; baseline: Record<string, unknown> } {
  // What this window changed is measured from where its edits began (`mine`); each such field is guarded by the version it
  // now works from (`guard`) — after «keep mine» the other device's. Measured from that one, the words left untouched here
  // would count as changed and go out over the words written there (Codex review r3, 2026-10-28).
  const read = (note: StudyNote) => ({ content: note.content ?? '', type: note.type ?? NO_TYPE, title: note.title ?? '', paragraph: note.paragraph });
  const was = read(mine);
  const guarded = read(guard);
  const updates: Partial<StudyNote> = { ...placing.updates };
  const baseline: Record<string, unknown> = { ...placing.baseline };
  for (const field of ['content', 'type', 'title', 'paragraph'] as const) {
    const value = fields[field];
    // The words go out trimmed: words stored with a trailing space are not changed by being saved as they were.
    if (value === undefined || value === (field === 'content' ? was.content.trim() : was[field])) continue;
    updates[field] = value as never;
    baseline[field] = guarded[field];
  }
  return { updates, baseline };
}

/**
 * The other device's version from a refused save: every compared field comes back with what the server holds (a note
 * stored without a type as a note). The guard reports only the fields this save compared, now only those it changed: the
 * rest are read from the list as it stands — a comment made a note there must be seen as one when its version is taken
 * (Codex review r2, 2026-10-28) — and from what the window opened with while the list does not have it.
 */
function storedVersion({ actualRevision, serverValues }: { actualRevision: number; serverValues: Record<string, unknown> }, opened: StudyNote | undefined, live: StudyNote | undefined): StoredVersion {
  const { content, type, title, scriptureRefs, paragraph } = serverValues;
  const known = live ?? opened;
  return {
    revision: actualRevision,
    content: typeof content === 'string' ? content : known?.content ?? '',
    type: typeof type === 'string' ? type as StudyNoteType : known ? known.type ?? NO_TYPE : 'comment',
    title: typeof title === 'string' ? title : known?.title ?? '',
    scriptureRefs: Array.isArray(scriptureRefs) ? scriptureRefs as ScriptureReference[] : live?.scriptureRefs ?? null,
    // The kind is the person's as the words are: reported, it is what the other device chose (null — never chosen there).
    paragraph: 'paragraph' in serverValues ? (typeof paragraph === 'boolean' ? paragraph : undefined) : known?.paragraph,
    reported: Object.keys(serverValues),
  };
}

/**
 * The other device's version as it stands when the person answers: a field the refusal did not report is read again from
 * the list then — it may have arrived after the refusal, a comment made a note there (Codex review r3, 2026-10-28).
 */
function asItStands(version: StoredVersion, live: StudyNote | undefined): StoredVersion {
  if (!live) return version;
  const now = (field: 'content' | 'title', value: string) => (version.reported.includes(field) ? value : live[field] ?? value);
  return {
    ...version,
    content: now('content', version.content),
    type: version.reported.includes('type') ? version.type : live.type ?? NO_TYPE,
    title: now('title', version.title),
    scriptureRefs: version.reported.includes('scriptureRefs') ? version.scriptureRefs : live.scriptureRefs ?? version.scriptureRefs,
    paragraph: version.reported.includes('paragraph') ? version.paragraph : live.paragraph,
  };
}

/**
 * THE WAY FROM A COMMENT TO A NOTE (the owner, 2026-10-28: «эта полоска должна показывать от чего-то до заметки…
 * от серого постепенно зеленеть»): the comment's grey mark at one end, the note's green one at the other, the
 * line filling from grey to green as the person writes. Its unit is the way itself, so it needs no number; a
 * screen reader hears the count (`utils/commentLength.ts`). Written as a paragraph, its start is the paragraph's:
 * the window's title says «Абзац», and one thing has one name in the window (case 2026-11-06-comment-paragraph).
 */
export function CommentWayBar({ text, paragraph = false }: { text: string; paragraph?: boolean }) {
  const { t } = useTranslation();
  const { sentences, share, isNote } = measureComment(text);
  const label = isNote ? t('comment.wayNote') : t('comment.wayLabel', { count: Math.min(COMMENT_SENTENCES, Math.round(sentences)), total: COMMENT_SENTENCES });
  const StartIcon = paragraph ? ParagraphIcon : CommentIcon;
  return (
    <div className="flex items-center gap-2" data-testid="comment-way">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-500"><StartIcon className="h-2.5 w-2.5 text-white" /></span>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{paragraph ? t('comment.kind.paragraph') : t('studiesWorkspace.type.comment')}</span>
      <div role="img" aria-label={label} className="relative h-1 flex-1 overflow-hidden rounded-full bg-gradient-to-r from-[#8b8f98] to-emerald-600 dark:from-gray-400 dark:to-emerald-400">
        <div className="absolute inset-y-0 right-0 bg-gray-200 transition-[width] duration-200 dark:bg-gray-700" style={{ width: `${Math.round((1 - share) * 100)}%` }} data-testid="comment-way-rest" />
      </div>
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600"><RectangleStackIcon className="h-2.5 w-2.5 text-white" aria-hidden="true" /></span>
      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{t('studiesWorkspace.type.note')}</span>
    </div>
  );
}

/**
 * THE COMMENT'S WINDOW (case 2026-10-12-block-diagram, 3.2): a comment is written and edited only here (the owner,
 * 2026-10-28), with the notes' own editor and toolbar — bold, italic, lists, quote — over a few sentences or a
 * short list. Past five sentences it is a note: the bar turns green, a line offers it, and the main button says
 * «Сделать заметкой»; nothing is cut. Saving goes through the one door of study notes (`useStudyNotesEngine`), so
 * it waits for the device's own commit, works offline and refuses a write built from an older version. Until saved,
 * the words are kept on the device (`useDurableDraft`): a reload, the browser's Back or a phone closing the tab does
 * not lose them, and the window opened there again offers them back.
 */
/** The words on the device still to be answered, or null; words equal to the window's are settled as taken. */
function useWaitingDraft(
  recovered: CommentDraft | null,
  shown: { text: string | null; written: string; title: string; placeWaits: boolean; paragraph?: boolean },
  accept: () => void,
  sourceKey: string | null,
): CommentDraft | null {
  const offered = shown.text !== null && typeof recovered?.text === 'string' ? recovered : null;
  const differs = offered !== null && (offered.text !== shown.written || (offered.title ?? '') !== shown.title
    || shown.placeWaits || (offered.paragraph !== undefined && offered.paragraph !== shown.paragraph));
  useSettleShownDraft(offered !== null && !differs, accept, sourceKey);
  return differs ? offered : null;
}

type ParagraphChoice = {
  initial: boolean;
  inferFromReference?: (reference: ScriptureReference) => boolean;
};

/**
 * WHAT THE COMMENT IS IN THE READER, as the person chooses it in the window (case 2026-11-06-comment-paragraph): a new one as
 * its button chose, a written one as it was saved or — never chosen — as the reader's `initial` reads it. The kind it opened
 * with is taken once (`take`): the reader may name the same comment's place anew, and a kind read again from that would look
 * changed with nothing touched. Taking a stored version gives the window a new place to read. `changed` — the person switched it here.
 */
function useCommentKind(target: CommentTarget, found: StudyNote | undefined, choice: ParagraphChoice | undefined) {
  const kindOf = (note: StudyNote | undefined, acceptedPlace?: ScriptureReference) => note?.paragraph
    ?? (acceptedPlace ? choice?.inferFromReference?.(acceptedPlace) : undefined) ?? choice?.initial ?? false;
  const [asParagraph, setAsParagraph] = useState(() => (target.kind === 'edit' ? kindOf(found) : choice?.initial ?? false));
  const [restoredKind, setRestoredKind] = useState<boolean | undefined>();
  const opened = useRef<boolean | null>(target.kind === 'edit' && found ? kindOf(found) : null);
  const take = (note: StudyNote, acceptedPlace?: ScriptureReference) => {
    opened.current = kindOf(note, acceptedPlace);
    setAsParagraph(opened.current);
    setRestoredKind(undefined);
  };
  const choose = (paragraph: boolean) => {
    if (paragraph === asParagraph) return;
    setRestoredKind(undefined);
    setAsParagraph(paragraph);
  };
  const restore = (paragraph: boolean | undefined) => {
    setRestoredKind(paragraph);
    if (paragraph !== undefined) setAsParagraph(paragraph);
  };
  const changed = Boolean(choice) && opened.current !== null && asParagraph !== opened.current;
  // A restored choice is still an edit on a screen with no kind switch, such as Studies.
  const pending = restoredKind ?? (choice && (target.kind === 'new' || changed) ? asParagraph : undefined);
  /**
   * The kind as the window shows and saves it, given whether the words have grown into a note: a note has no kind. `offered` —
   * the switch is shown; `heading` — saved as a paragraph; `fields` — what a new one is saved with; `switched` — a written
   * one's kind to write, when changed here; `madeParagraphAt` — the place a comment made a paragraph where it stands is checked
   * at, as one moved there is.
   */
  const asWritten = (isNote: boolean, standing: ScriptureReference | undefined, storedKind: boolean | undefined) => {
    const offered = Boolean(choice) && !isNote;
    const heading = offered && asParagraph;
    return {
      offered,
      heading,
      titleKey: heading ? 'comment.titleParagraph' : 'comment.title',
      descriptionKey: heading ? 'comment.paragraphDescription' : 'comment.description',
      fields: !isNote && pending !== undefined ? { paragraph: pending } : {},
      switched: !isNote ? pending : undefined,
      madeParagraphAt: !isNote && pending === true && storedKind !== true ? standing ?? null : null,
    };
  };
  return { asParagraph, choose, restore, take, changed: changed || restoredKind !== undefined, pending, asWritten };
}

/** «Комментарий | Абзац» at the top of the window: what the comment is in the reader. */
function CommentKindSwitch({ paragraph, onChange, disabled }: { paragraph: boolean; onChange: (paragraph: boolean) => void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('comment.kind.label')} className="flex gap-0.5 rounded-xl bg-gray-100 p-[3px] dark:bg-gray-950" data-testid="comment-kind">
      {([false, true] as const).map((one) => (
        <button
          key={String(one)}
          type="button"
          aria-pressed={paragraph === one}
          disabled={disabled}
          onClick={() => onChange(one)}
          className={`h-8 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-semibold disabled:opacity-50 ${paragraph === one
            ? 'bg-white text-gray-900 shadow-sm dark:bg-indigo-600 dark:text-white'
            : 'text-gray-600 dark:text-gray-300'}`}
        >
          {t(one ? 'comment.kind.paragraph' : 'comment.kind.comment')}
        </button>
      ))}
    </div>
  );
}

export function CommentDialog({ target, place, context, bible, placeOf, placePicker, restorePlace, onErased, onClose, onSaved, returnFocusTo, openingPlace, away, onChooseVerses, versesRefusal, placeRefusal, paragraphChoice }: {
  target: CommentTarget;
  /** "Ис 40:31", "Ис 40–41": the place the comment is written to; empty while a new one's place is not chosen. */
  place: string;
  /** The Bible the screen under the window reads (the reader's); places it moves to are counted in it. By default, the interface's. */
  bible?: BibleId;
  /** How that screen names a place, so a place moved to reads as `place` does; by default as Studies name it. */
  placeOf?: (reference: ScriptureReference) => string;
  /** The verse's words, or "Ис 40–41 — главы целиком" for a comment on whole chapters; empty where the text is not at hand. */
  context?: string;
  /**
   * Where a new comment's place is chosen (Studies, away from the Bible): drawn over the editor. Given the window's own
   * close, which asks before throwing typed text away, so a picker's Cancel never loses it.
   */
  placePicker?: (window: { requestClose: () => void }) => React.ReactNode;
  /** With `placePicker`: words brought back from the device return to the place they were written to. */
  restorePlace?: (reference: ScriptureReference) => void;
  /** After the comment is erased, where the screen under the window shows it still (its own page): leave it. */
  onErased?: () => void;
  onClose: () => void;
  /**
   * Saved as a comment — the device took it — given its id, just before the window closes: the reader brings it into sight
   * (`readerSight.ts`). Not called for one that grew into a note: it leaves the screen under the window.
   */
  onSaved?: (id: string) => void;
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** An explicitly clicked displayed occurrence; it never changes the authored reference. */
  openingPlace?: string;
  /** Stepped aside while its verses are chosen in the reader, kept with everything typed (`FormDialog` `away`). */
  away?: boolean;
  /**
   * The reader's «Изменить стихи» (phase 9): given where the comment stands now, and how to move it once the verses are
   * chosen — the move waits for «Готово», as a move from the list does.
   */
  onChooseVerses?: (here: ScriptureReference, moveTo: (reference: ScriptureReference) => void, asParagraph?: boolean) => void;
  /** With `onChooseVerses`: why its verses cannot be chosen in the text there (another book, not one run of verses); null — they can. */
  versesRefusal?: (here: ScriptureReference) => string | null;
  /**
   * Why a place chosen in this window cannot be saved — a paragraph that would cross another (phase 9); null where it may.
   * Asked on «Готово» of a new comment's place and of a written one's new place: the list of places and a paragraph
   * arriving from another device after the verses were chosen do not go round the rule.
   */
  placeRefusal?: (reference: ScriptureReference, paragraph?: boolean) => FailureWords | null;
  /**
   * The reader's choice of what the comment is (the owner, 2026-11-06: «комментарий и абзац — разные вещи»): the window
   * shows «Комментарий | Абзац» and saves the one chosen (`StudyNote.paragraph`). `initial` — a new one's kind as its
   * button chose, a written one's as its length reads when it was never chosen. An accepted version can be read from its
   * own reference. Studies supplies no switch.
   */
  paragraphChoice?: ParagraphChoice;
}) {
  const { t, language } = useTranslation();
  const { uid, notes, commentCollectionReady, createNote, updateNote, deleteNote, observeCommentKind, captureActionTime } = useStudyNotesEngine(true);
  const { confirm, confirmDialog } = useConfirm();
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const found = target.kind === 'edit' ? notes.find((note) => note.id === target.id) : undefined;
  // The comment as the list holds it now, for a refused save's answer, which arrives after the render that sent it.
  const live = useRef(found);
  live.current = found;
  // The comment as the window opened it: the revision guard compares a save with this, not with the list now.
  const opened = useRef<StudyNote | undefined>(found);
  const [openingKind] = useState(() => found && observeCommentKind?.(found));
  const kindBasis = useRef(openingKind);
  // Where this window's edits began: the version it opened with, or the other device's once that was taken.
  const mine = useRef<StudyNote | undefined>(found);
  const [text, setText] = useState<string | null>(target.kind === 'edit' ? found?.content ?? null : '');
  // The name it takes past five sentences, as a note (the owner, 2026-10-28: «без имени толку нету»).
  const [title, setTitle] = useState(found?.title ?? '');
  // What it is in the reader — a paragraph or a comment — as the person chooses it here (`paragraphChoice`).
  const kind = useCommentKind(target, found, paragraphChoice);
  useEffect(() => {
    if (text !== null || !found) return;
    opened.current = found;
    kindBasis.current = observeCommentKind?.(found);
    mine.current = found;
    setText(found.content);
    setTitle(found.title ?? '');
    kind.take(found);
    // Taken once, when the written comment first arrives — as its words are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, text]);
  const [saving, setSaving] = useState(false);
  const [placementError, setPlacementError] = useState<FailureWords | null>(null);
  // Another device changed the comment since it opened: what it holds now, to keep mine on top of it or take it.
  const [conflict, setConflict] = useState<StoredVersion | null>(null);
  const [restoredWithoutTitle, setRestoredWithoutTitle] = useState(false);
  const [restoredPlace, setRestoredPlace] = useState<RestoredCommentPlace | null>(null);
  const reference = commentDraftReference(target, restoredPlace);
  // Where it stands and where it moves on «Готово»: a written comment's first reference, a new one's own.
  const where = useCommentPlace({
    ...(target.kind === 'edit'
      ? { standing: (opened.current ?? found)?.scriptureRefs?.[0], newPlace: undefined, ownId: target.id }
      : { standing: reference ?? undefined, newPlace: reference, ownId: undefined }),
    choosesOwn: Boolean(placePicker), restoreOwn: restorePlace, bible, placeOf, context, openingPlace, notes,
  });
  const { keptPlace } = where;
  const written = text ?? '';
  const standing = opened.current ?? found;
  const initial = opened.current?.content ?? '';
  const initialTitle = opened.current?.title ?? '';
  const [slot] = useState(() => commentDraftDocument(target, Boolean(placePicker)));
  const [writerId] = useState(newClientId);
  // Words the device accepted, or the person threw away: from then on they are the baseline, not the opening words —
  // else a render after the save would make them «unsaved» again and the write on closing would keep them.
  const settled = useRef<CommentDraft | null>(null);
  const kept = useMemo(() => commentDraftValue(written, keptPlace, title, restoredWithoutTitle, kind.pending),
    [written, keptPlace, title, restoredWithoutTitle, kind.pending]);
  // The place alone is no unsaved work: the baseline carries the place now chosen.
  const draft = useDurableDraft<CommentDraft>({
    uid, docId: slot, aggregate: COMMENT_DRAFT_AGGREGATE, writerId, findCopies: findCommentDraftCopies, value: kept, enabled: text !== null,
    confirmedValue: text === null ? null : settled.current ?? commentDraftValue(initial, reference, initialTitle, restoredWithoutTitle,
      target.kind === 'new' ? paragraphChoice?.initial : undefined),
    isRecoveredDraftSaved: isCommentDraftSaved,
  });
  const settle = () => {
    settled.current = kept;
    draft.markSaved(kept);
  };
  // Offered only once the comment is in the editor: restored before, its loading would no longer take the opening version.
  const recovered = draft.recovered;
  // A place it was moving to waits too.
  const placeWaits = where.waits(recovered?.reference);
  const savedKind = standing?.paragraph;
  // Compare the proven opening fields in the proposed copy's historical shape, never the words being typed.
  const verifiedRecovery = useMemo(() => target.kind === 'edit' && recovered
    ? commentDraftValue(initial, reference, initialTitle, recovered.title === undefined,
      recovered.paragraph === undefined ? undefined : savedKind)
    : undefined, [target.kind, recovered, initial, reference, initialTitle, savedKind]);
  const { settleRecovered } = draft;
  const settleShown = useCallback(() => settleRecovered(verifiedRecovery), [settleRecovered, verifiedRecovery]);
  const waiting = useWaitingDraft(recovered, { text, written, title, placeWaits, paragraph: kind.pending ?? savedKind }, settleShown, draft.recoveredKey);
  // Resolve the initial recovery question before writing; other independent copies
  // remain available after this opening's explicit choice without locking it again.
  const { held: deciding, answer: answerDraftQuestion } = useDraftQuestion(JSON.stringify([uid, writerId]), waiting !== null);
  const restore = () => {
    if (!waiting) return;
    setText(waiting.text);
    setTitle(waiting.title ?? '');
    kind.restore(waiting.paragraph);
    setRestoredWithoutTitle(waiting.title === undefined);
    if (!placePicker && target.kind === 'new' && target.reference && waiting.reference) {
      setRestoredPlace({ openingId: target.reference.id, reference: waiting.reference });
    }
    if (waiting.reference) where.bringBack(waiting.reference);
    draft.acceptRecovered();
    answerDraftQuestion();
  };
  const { sentences, isNote } = measureComment(written);
  // Nothing to read: no words at all — an emptied list item or quote leaves only its mark («-», «>»).
  const empty = sentences === 0;
  // A comment stands on a verse or a chapter: a whole book names no place in the reader, so it cannot be one's place.
  const placed = target.kind === 'edit' || Boolean(target.reference?.chapter);
  // The kind changed here — a paragraph made a comment, or one made a paragraph, its words untouched — is unsaved work too.
  const unsaved = written !== initial || title !== initialTitle || where.moved !== null || kind.changed;
  // A note without a name is no use (the owner, 2026-10-28): the main button waits for one.
  const named = !isNote || Boolean(title.trim());
  // Thrown away by the person's own choice: retired like saved words, so the write on closing does not keep them.
  const closeDiscarding = () => {
    settle();
    onClose();
  };
  // Every way out — Cancel, the close button, Escape — asks before typed text is thrown away.
  const requestClose = () => { void askBeforeDiscard(unsaved, closeDiscarding); };

  const failed = (error: unknown) => {
    setSaving(false);
    if (isStaleWriteError(error)) {
      setConflict(storedVersion(error, opened.current, live.current));
      return;
    }
    toast.error(t('comment.notSaved'));
  };

  /**
   * Adopts what the other device stored as the version this window works from — every compared field with its revision:
   * a type left as it opened would be refused again on each «keep mine» (Codex review, 2026-10-28).
   */
  const adopt = (found: StoredVersion) => {
    if (!opened.current) return;
    opened.current = {
      ...opened.current, content: found.content, type: found.type, title: found.title, paragraph: found.paragraph,
      ...(found.scriptureRefs ? { scriptureRefs: found.scriptureRefs } : {}),
      rev: { ...(opened.current.rev ?? {}), [NOTE_AGGREGATE]: found.revision },
    };
    kindBasis.current = observeCommentKind?.(opened.current);
  };

  // As a comment — not a note — it is what the switch says: a heading over its verses or words beside them; the kind goes
  // out where the window offers the choice — a new one's always, a written one's only when switched here.
  const asWritten = kind.asWritten(isNote, standing?.scriptureRefs?.[0], standing?.paragraph);
  const save = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (empty || saving || !placed || !named) return;
    const actionTime = target.kind === 'edit' && kind.pending !== undefined ? captureActionTime?.() ?? null : null;
    const note = opened.current;
    const visible = live.current;
    // Keep mine adopts a new guard immediately. The rendered title can still belong to the earlier opening.
    const current = (visible?.rev?.[NOTE_AGGREGATE] ?? 0) > (note?.rev?.[NOTE_AGGREGATE] ?? 0) ? visible : note;
    const writing = kind.asWritten(isNote, current?.scriptureRefs?.[0], current?.paragraph);
    const placing = target.kind === 'new' ? keptPlace : where.moved;
    // The paragraphs' rule is a paragraph's: one saved as a note leaves the reader's paragraphs (Codex review r3).
    const checked = placing ?? writing.madeParagraphAt;
    const chosenKind = kind.pending ?? (paragraphChoice ? kind.asParagraph : undefined);
    let refused: FailureWords | null | undefined;
    if (checked && !isNote) {
      if (placeRefusal) refused = placeRefusal(checked, chosenKind);
      else if (chosenKind === true) {
        const locale = resolveAppLocale(language);
        const targetBible = checked.bible ?? referenceBibleFor(locale);
        refused = paragraphPlaceRefusal(checked, targetBible, chosenKind, target.kind === 'edit' ? target.id : undefined,
          book => commentCollectionReady ? storedCommentLayout(notes, book, targetBible, locale) : null, locale);
      }
    }
    if (refused) {
      if (placeRefusal) toast.error(sayFailure(refused, t));
      else setPlacementError(refused);
      return;
    }
    setPlacementError(null);
    const content = written.trim();
    if (target.kind === 'edit' && !note) return;
    setConflict(null);
    const type = isNote ? 'note' : 'comment';
    // A comment keeps no name of its own; as a note it is saved with the one given here.
    const naming = isNote ? { title: title.trim() } : {};
    if (target.kind === 'new') {
      setSaving(true);
      const created = createNote({ userId: uid ?? '', content, title: naming.title ?? '', scriptureRefs: keptPlace ? [keptPlace] : [], tags: [], type, ...writing.fields });
      created.acceptance.then(() => saved(created.note.id), failed);
      return;
    }
    const { updates, baseline } = changesOf({ mine: mine.current ?? note!, guard: note! }, { content, type, ...naming, paragraph: writing.switched }, where.write(note?.scriptureRefs ?? []));
    // Nothing changed — nothing to write: «Готово» closes, and no revision moves for it.
    if (!Object.keys(updates).length) {
      closeDiscarding();
      return;
    }
    setSaving(true);
    const { id } = target;
    const switchedKind = typeof updates.paragraph === 'boolean';
    const seen = switchedKind ? kindBasis.current : undefined;
    updateNote({ id, updates, expectedRevision: note?.rev?.[NOTE_AGGREGATE] ?? null,
      expectedBaseline: switchedKind ? { ...baseline, scriptureRefs: note?.scriptureRefs } : baseline,
      ...(seen && { commentKindCapture: { seen, time: actionTime } }),
    }).acceptance.then(() => saved(id), failed);
  };
  const saved = (id: string) => {
    settle();
    if (isNote) toast.success(t('comment.becameNote'));
    else onSaved?.(id);
    onClose();
  };

  // «Стереть» — a rare action, quiet and drawn on the left of the foot, away from Save; asked before it erases.
  const erase = async () => {
    if (target.kind !== 'edit') return;
    if (!(await confirm({ title: { key: 'comment.eraseTitle' }, confirmText: { key: 'comment.erase' } }))) return;
    setSaving(true);
    deleteNote(target.id).acceptance.then(() => {
      settle();
      (onErased ?? onClose)();
    }, failed);
  };

  const keepMine = () => {
    if (!conflict) return;
    adopt(asItStands(conflict, live.current));
    save();
  };
  const takeTheirs = () => {
    if (!conflict) return;
    const theirs = asItStands(conflict, live.current);
    // Taken there for a note: there is nothing of this window's left to write, and «Готово» here would make it a comment
    // again (Codex review, 2026-10-28). The window closes and says where it is.
    if (theirs.type !== 'comment') {
      toast.success(t('comment.noteElsewhere'));
      closeDiscarding();
      return;
    }
    adopt(theirs);
    // Taken, their version is where this window's edits begin now — their kind too: the switch shows what they chose
    // (visual pass, Codex review 2026-11-07: «take theirs» took their words and left this window's switch).
    mine.current = opened.current;
    if (opened.current) kind.take(opened.current, theirs.scriptureRefs?.[0]);
    setText(theirs.content);
    setTitle(theirs.title);
    // Their version is taken whole: where they left it stands, and a place chosen here is let go.
    if (theirs.scriptureRefs) where.tookTheirs();
    setConflict(null);
  };
  const shownPlace = where.shown(place);

  return (
    <FormDialog
      away={away}
      title={shownPlace ? t(asWritten.titleKey, { place: shownPlace }) : t('comment.titleNew')}
      titleAction={where.movable ? (
        <div ref={where.buttonRef}>
          <MovePlaceButton open={where.open} disabled={saving || deciding} onToggle={where.toggle} />
        </div>
      ) : null}
      description={t(asWritten.descriptionKey)}
      onClose={closeDiscarding}
      returnFocusTo={returnFocusTo}
      unsaved={unsaved}
      closeDisabled={saving}
      onSubmit={save}
      footer={(
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
          <FormActions
            onCancel={closeDiscarding}
            cancelLabel={t('common.cancel')}
            submitLabel={isNote ? t('comment.toNote') : t('common.done')}
            saving={saving}
            submitDisabled={empty || !placed || deciding || !named}
            tone={isNote ? 'emerald' : 'blue'}
            unsaved={unsaved}
          />
          {target.kind === 'edit' ? (
            <button type="button" onClick={() => { void erase(); }} disabled={saving || deciding} className="rounded-xl px-3 py-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200">
              {t('comment.erase')}
            </button>
          ) : null}
        </div>
      )}
    >
      <div className="space-y-4">
        {asWritten.offered ? <CommentKindSwitch paragraph={kind.asParagraph} onChange={kind.choose} disabled={saving || deciding} /> : null}
        {asWritten.offered && target.kind === 'edit' && uid && kindBasis.current &&
          <DocumentFieldHistory key={JSON.stringify([uid, target.id, kindBasis.current.generation])}
            session={{ owner: uid, noteId: target.id, generation: kindBasis.current.generation, field: 'comment-kind',
              restore: async paragraph => { kind.choose(paragraph); } }}
            current={kind.asParagraph} disabled={saving || deciding} />}
        {/* The words waiting are answered first: they may bring their own place back, so the choice of one waits. */}
        {/* Nor while a save is accepted: a place chosen then would show, and the one sent would be saved (Codex review r3). */}
        {deciding || saving ? null : placePicker?.({ requestClose })}
        {placementError ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-800 dark:bg-red-950 dark:text-red-200">{sayFailure(placementError, t)}</p> : null}
        {conflict ? <SaveConflictBanner entityKey="entityComment" onKeepMine={keepMine} onTakeTheirs={takeTheirs} busy={saving} /> : null}
        {waiting ? (
          <UnsavedDraftOffer
            preview={(
              <>
                {where.offered(waiting.reference) ? (
                  <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{where.offered(waiting.reference)}</p>
                ) : null}
                {waiting.paragraph !== undefined ? <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
                  {t(waiting.paragraph ? 'comment.kind.paragraph' : 'comment.kind.comment')}
                </p> : null}
                <MarkdownDisplay pencil content={waiting.text} className="text-sm text-gray-700 dark:text-gray-200" />
              </>
            )}
            onRestore={restore}
            onDiscard={() => { draft.discardRecovered(); answerDraftQuestion(); }}
          />
        ) : null}
        {/* The verses are chosen for what the switch says now: a comment's keep no paragraphs' rule (Codex review, 2026-11-07). */}
        <CommentPlaceShown where={where} place={place} busy={saving} deciding={deciding} onChooseVerses={onChooseVerses ? (here, moveTo) => onChooseVerses(here, moveTo, asWritten.offered ? kind.asParagraph : undefined) : undefined} versesRefusal={versesRefusal} />
        {/* Still while a save is accepted — words typed then would be closed away with the window — and while words from last time wait for an answer. */}
        {text === null ? null : <RichMarkdownEditor value={text} onChange={setText} placeholder={t('comment.placeholder')} minHeight="11rem" autoFocus editable={!saving && !deciding} />}
        <CommentWayBar text={written} paragraph={asWritten.heading} />
        {isNote ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{t('comment.becomesNote')}</p>
            <FormField label={t('comment.noteTitle')} required>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('comment.noteTitlePlaceholder')}
                className={FORM_INPUT_CLASS}
                disabled={saving || deciding}
              />
            </FormField>
          </div>
        ) : null}
      </div>
      {confirmDialog}
      {discardDialog}
    </FormDialog>
  );
}
