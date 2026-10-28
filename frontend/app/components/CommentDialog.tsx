'use client';

import { RectangleStackIcon } from '@heroicons/react/20/solid';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { CommentIcon } from '@/components/Icons';
import MarkdownDisplay from '@/components/MarkdownDisplay';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import FormField, { FORM_INPUT_CLASS } from '@/components/ui/FormField';
import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';
import { UnsavedDraftOffer } from '@/components/UnsavedDraftOffer';
import { useConfirm, useDiscardQuestion } from '@/hooks/useConfirm';
import { useDurableDraft } from '@/hooks/useDurableDraft';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { NOTE_AGGREGATE } from '@/services/studies.service';
import { resolveAppLocale } from '@/utils/appLocale';
import { COMMENT_SENTENCES, measureComment } from '@/utils/commentLength';
import { formatScriptureReference } from '@/utils/scriptureReference';

import type { ScriptureReference, StudyNote, StudyNoteType } from '@/models/models';

/** What the window writes: a new comment on a place, or one already written. */
export type CommentTarget = { kind: 'new'; reference: ScriptureReference | null } | { kind: 'edit'; id: string };

/** The part of a document the window's words are kept under on the device until they are saved. */
const COMMENT_DRAFT = 'comment';

/** What waits on the device: the words, the place a new comment was being written to, the name it takes as a note. */
type CommentDraft = { text: string; reference: ScriptureReference | null; title?: string };

/**
 * Where on the device the words wait until saved: a written comment under its own id; a new one opened on a place under
 * that place, so the same door finds them again after a reload; a window that chooses its own place (Studies) in one
 * slot of its own, which the place it changes to does not move.
 */
function draftSlot(target: CommentTarget, choosesPlace: boolean): string {
  if (target.kind === 'edit') return target.id;
  const reference = target.reference;
  if (choosesPlace || !reference?.chapter) return 'new';
  return `new:${reference.bible ?? ''}:${reference.book}:${reference.chapter}:${reference.fromVerse ?? ''}`;
}

/**
 * THE WAY FROM A COMMENT TO A NOTE (the owner, 2026-10-28: «эта полоска должна показывать от чего-то до заметки…
 * от серого постепенно зеленеть»): the comment's grey mark at one end, the note's green one at the other, the
 * line filling from grey to green as the person writes. Its unit is the way itself, so it needs no number; a
 * screen reader hears the count (`utils/commentLength.ts`).
 */
export function CommentWayBar({ text }: { text: string }) {
  const { t } = useTranslation();
  const { sentences, share, isNote } = measureComment(text);
  const label = isNote ? t('comment.wayNote') : t('comment.wayLabel', { count: Math.min(COMMENT_SENTENCES, Math.round(sentences)), total: COMMENT_SENTENCES });
  return (
    <div className="flex items-center gap-2" data-testid="comment-way">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-500"><CommentIcon className="h-2.5 w-2.5 text-white" /></span>
      <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">{t('studiesWorkspace.type.comment')}</span>
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
export function CommentDialog({ target, place, context, placePicker, restorePlace, onErased, onClose }: {
  target: CommentTarget;
  /** "Ис 40:31", "Ис 40–41": the place the comment is written to; empty while a new one's place is not chosen. */
  place: string;
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
}) {
  const { t, i18n } = useTranslation();
  const { uid, notes, createNote, updateNote, deleteNote } = useStudyNotesEngine(true);
  const { confirm, confirmDialog } = useConfirm();
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const found = target.kind === 'edit' ? notes.find((note) => note.id === target.id) : undefined;
  // The comment as the window opened it: the revision guard compares a save with this, not with the list now.
  const opened = useRef<StudyNote | undefined>(found);
  const [text, setText] = useState<string | null>(target.kind === 'edit' ? found?.content ?? null : '');
  // The name it takes past five sentences, as a note (the owner, 2026-10-28: «без имени толку нету»).
  const [title, setTitle] = useState(found?.title ?? '');
  useEffect(() => {
    if (text !== null || !found) return;
    opened.current = found;
    setText(found.content);
    setTitle(found.title ?? '');
  }, [found, text]);
  const [saving, setSaving] = useState(false);
  // Another device changed the comment since it opened: what it holds now, to keep mine on top of it or take it.
  const [conflict, setConflict] = useState<{ revision: number; content: string; type: StudyNoteType; title: string } | null>(null);
  const written = text ?? '';
  const initial = opened.current?.content ?? '';
  const initialTitle = opened.current?.title ?? '';
  const [slot] = useState(() => draftSlot(target, Boolean(placePicker)));
  // Words the device accepted, or the person threw away: from then on they are the baseline, not the opening words —
  // else a render after the save would make them «unsaved» again and the write on closing would keep them.
  const settled = useRef<{ text: string; title: string } | null>(null);
  const reference = target.kind === 'new' ? target.reference : null;
  const kept = useMemo<CommentDraft>(() => ({ text: written, reference, title }), [written, reference, title]);
  // The place alone is no unsaved work: the baseline carries the place now chosen.
  const draft = useDurableDraft<CommentDraft>({
    uid, docId: slot, aggregate: COMMENT_DRAFT, value: kept, enabled: text !== null,
    confirmedValue: text === null ? null : { text: settled.current?.text ?? initial, reference, title: settled.current?.title ?? initialTitle },
  });
  const settle = () => {
    settled.current = { text: written, title };
    draft.markSaved(kept);
  };
  // Offered only once the comment is in the editor: restored before, its loading would no longer take the opening version.
  const recovered = draft.recovered;
  const waiting = text !== null && typeof recovered?.text === 'string' && (recovered.text !== written || (recovered.title ?? '') !== title) ? recovered : null;
  // Until the person says what becomes of the words waiting, the editor holds still: typing would write over the only
  // copy of them on the device while the offer still shows them (Codex review, 2026-10-28).
  const deciding = waiting !== null;
  const restore = () => {
    if (!waiting) return;
    setText(waiting.text);
    setTitle(waiting.title ?? '');
    if (placePicker && waiting.reference) restorePlace?.(waiting.reference);
    draft.acceptRecovered();
  };
  const { sentences, isNote } = measureComment(written);
  // Nothing to read: no words at all — an emptied list item or quote leaves only its mark («-», «>»).
  const empty = sentences === 0;
  // A comment stands on a verse or a chapter: a whole book names no place in the reader, so it cannot be one's place.
  const placed = target.kind === 'edit' || Boolean(target.reference?.chapter);
  const unsaved = written !== initial || title !== initialTitle;
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
      // Every compared field comes back with what the server holds (a note stored without a type as a note).
      const { content, type, title: storedTitle } = error.serverValues;
      setConflict({
        revision: error.actualRevision,
        content: typeof content === 'string' ? content : opened.current?.content ?? '',
        type: typeof type === 'string' ? type as StudyNoteType : opened.current?.type ?? 'comment',
        title: typeof storedTitle === 'string' ? storedTitle : opened.current?.title ?? '',
      });
      return;
    }
    toast.error(t('comment.notSaved'));
  };

  /**
   * Adopts what the other device stored as the version this window works from — every compared field with its revision:
   * a type left as it opened would be refused again on each «keep mine» (Codex review, 2026-10-28).
   */
  const adopt = (found: { revision: number; content: string; type: StudyNoteType; title: string }) => {
    if (!opened.current) return;
    opened.current = { ...opened.current, content: found.content, type: found.type, title: found.title, rev: { ...(opened.current.rev ?? {}), [NOTE_AGGREGATE]: found.revision } };
  };

  const save = (event?: React.FormEvent) => {
    event?.preventDefault();
    if (empty || saving || !placed || !named) return;
    const content = written.trim();
    const note = opened.current;
    if (target.kind === 'edit' && !note) return;
    setConflict(null);
    const type = isNote ? 'note' : 'comment';
    // A comment keeps no name of its own; as a note it is saved with the one given here.
    const naming = isNote ? { title: title.trim() } : {};
    const submission = target.kind === 'new'
      ? createNote({ userId: uid ?? '', content, title: naming.title ?? '', scriptureRefs: target.reference ? [target.reference] : [], tags: [], type })
      : updateNote({
        id: target.id,
        updates: { content, type, ...naming },
        expectedRevision: note?.rev?.[NOTE_AGGREGATE] ?? null,
        expectedBaseline: { content: note?.content ?? '', type: note?.type ?? 'comment', ...(isNote ? { title: note?.title ?? '' } : {}) },
      });
    setSaving(true);
    submission.acceptance.then(() => {
      settle();
      if (isNote) toast.success(t('comment.becameNote'));
      onClose();
    }, failed);
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
    adopt(conflict);
    save();
  };
  const takeTheirs = () => {
    if (!conflict) return;
    // Taken there for a note: there is nothing of this window's left to write, and «Готово» here would make it a comment
    // again (Codex review, 2026-10-28). The window closes and says where it is.
    if (conflict.type !== 'comment') {
      toast.success(t('comment.noteElsewhere'));
      closeDiscarding();
      return;
    }
    adopt(conflict);
    setText(conflict.content);
    setTitle(conflict.title);
    setConflict(null);
  };

  return (
    <FormDialog
      title={place ? t('comment.title', { place }) : t('comment.titleNew')}
      description={t('comment.description')}
      onClose={requestClose}
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
        {/* The words waiting are answered first: they may bring their own place back, so the choice of one waits. */}
        {deciding ? null : placePicker?.({ requestClose })}
        {conflict ? <SaveConflictBanner entityKey="entityComment" onKeepMine={keepMine} onTakeTheirs={takeTheirs} busy={saving} /> : null}
        {waiting ? (
          <UnsavedDraftOffer
            preview={(
              <>
                {placePicker && waiting.reference ? (
                  <p className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">{formatScriptureReference(waiting.reference, { locale: resolveAppLocale(i18n.language) })}</p>
                ) : null}
                <MarkdownDisplay pencil content={waiting.text} className="text-sm text-gray-700 dark:text-gray-200" />
              </>
            )}
            onRestore={restore}
            onDiscard={draft.discardRecovered}
          />
        ) : null}
        {context ? <p className="font-serif text-[15px] leading-relaxed text-gray-600 dark:text-gray-400">{context}</p> : null}
        {/* Still while a save is accepted — words typed then would be closed away with the window — and while words from last time wait for an answer. */}
        {text === null ? null : <RichMarkdownEditor value={text} onChange={setText} placeholder={t('comment.placeholder')} minHeight="11rem" autoFocus editable={!saving && !deciding} />}
        <CommentWayBar text={written} />
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
