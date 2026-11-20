'use client';


import { LightBulbIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import { ScriptureText } from '@/components/bible/ScriptureLinks';
import { useConfirm, type ConfirmKey } from '@/hooks/useConfirm';
import { useTranslation } from '@locales/useTranslation';

import type { SaveSermonNoteText } from '@/utils/sermonNoteText';

interface PointNoteProps {
  /** Current note text (undefined/empty = no note). */
  note?: string;
  /** Persist a new value; `undefined` clears the note. */
  onChange: (note: string | undefined) => void;
  /** Bind saving to what the person saw when they opened the field. */
  captureSave?: () => SaveSermonNoteText;
  isReadOnly?: boolean;
  /** Left indent so the note lines up under the point / sub-point text. */
  indentClass?: string;
  /**
   * Extra classes for the empty "+ note" affordance — the PARENT owns the hover group,
   * so it decides how the affordance reveals (e.g. `lg:group-hover/subpoint:opacity-100`).
   */
  addRevealClass?: string;
  /** Hide the inline × clear button (e.g. when the parent already provides its own delete). */
  hideClearButton?: boolean;
  /**
   * Accent family for the note affordance. `'note'` (default) = the amber "idea/lightbulb"
   * styling used in the plan editor & structure columns. `'neutral'` = gray + violet-focus,
   * used where amber would collide (e.g. the scratch capture screen).
   */
  tone?: 'note' | 'neutral';
  /**
   * `'reminder'` (default) — a small italic hint with a lightbulb, the plan editor's reminder note.
   * `'body'` — the words themselves at reading size, for hosts where the note IS the content
   * (a scratch note on the sorting board).
   */
  appearance?: 'reminder' | 'body';
  /** `false`: a click on the words does not open editing; the host opens it with `editSignal`. */
  clickToEdit?: boolean;
  /** Each new non-zero value opens editing (the host's own «edit» button). */
  editSignal?: number;
  /** Visible «Cancel» / «Save» under the field, for hosts where Enter, Escape and a click away are not obvious. */
  editActions?: { save: string; cancel: string };
  /** Tells the host when editing opens and closes (it may hide its own buttons meanwhile). */
  onEditingChange?: (editing: boolean) => void;
  /**
   * Wording overrides for hosts where "reminder note" is the wrong noun. The scratch
   * board edits a *scratch note* with this same editor, and the plan-editor labels
   * leaking in there make the screen read as if it were about a different entity.
   * Anything omitted falls back to the plan-editor wording.
   */
  labels?: {
    /** Tooltip on the filled note / aria-label on the empty affordance. */
    label?: string;
    /** Placeholder of the edit field. */
    placeholder?: string;
    /** aria-label of the inline clear button. */
    clear?: string;
    /** Text of the empty "+ note" affordance. */
    add?: string;
    /** Title of the question asked before the × clears the note, said when the question is shown. */
    deleteConfirm?: ConfirmKey;
  };
}

/**
 * Reminder note ("what I want to say here") shown under a plan point or sub-point —
 * a skeleton hint jotted BEFORE the point is filled with full thoughts, kept separate
 * from them. Buttonless editing: click away (blur) or Enter saves, Escape cancels; a
 * faint × deletes after asking — the hosts autosave, so a cleared note is gone for good.
 * Self-contained edit state, so it drops into any editor (the plan-editor board and the
 * structure-page columns share this one component).
 */
const PointNote: React.FC<PointNoteProps> = ({
  note,
  onChange,
  captureSave,
  isReadOnly = false,
  indentClass = '',
  addRevealClass = 'opacity-100',
  hideClearButton = false,
  tone = 'note',
  appearance = 'reminder',
  clickToEdit = true,
  editSignal = 0,
  editActions,
  onEditingChange,
  labels,
}) => {
  const body = appearance === 'body';
  const { t } = useTranslation();
  const labelText = labels?.label ?? t('planEditor.note.label');
  const placeholderText = labels?.placeholder ?? t('planEditor.note.placeholder');
  const clearText = labels?.clear ?? t('planEditor.note.delete');
  const addText = labels?.add ?? t('planEditor.note.add');
  const { confirm, confirmDialog, withdraw } = useConfirm();
  // The answer comes after an await. By then the host may have re-rendered: with a newer
  // outline (its old onChange would write the outline as it was when we asked), locked, or
  // with different note text — and a "yes" was given to the text in the question, not to that.
  const latestRef = useRef({ onChange, isReadOnly, note });
  useLayoutEffect(() => {
    latestRef.current = { onChange, isReadOnly, note };
  });
  /**
   * The open question and the note text it is about; null while nothing is asked. A new question
   * replaces this ticket, and only the continuation holding the current ticket may act — an
   * older, replaced question settles as "no" and must not touch what the newer one tracks.
   */
  const askedRef = useRef<{ text: string } | null>(null);
  useEffect(() => {
    if (askedRef.current && askedRef.current.text !== note) withdraw();
  }, [note, withdraw]);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const openingText = useRef<string | undefined>(undefined);
  const openedSave = useRef<SaveSermonNoteText | undefined>(undefined);
  const awaitingCapture = useRef(false);
  const [capturing, setCapturing] = useState(false);
  // Distinguishes a real blur-save from an Escape-cancel (Escape also blurs the field).
  const blurSaveRef = useRef(true);

  const neutral = tone === 'neutral';
  const editFieldClass = neutral
    ? 'bg-gray-50 dark:bg-gray-800/60 text-gray-700 dark:text-gray-100 border-gray-300 dark:border-gray-600 focus:ring-violet-400 placeholder:text-gray-500/50 dark:placeholder:text-gray-400/40'
    : 'bg-amber-50 dark:bg-amber-900/15 text-slate-700 dark:text-amber-50/90 border-amber-300 dark:border-amber-700/50 focus:ring-amber-400 placeholder:text-amber-700/40 dark:placeholder:text-amber-200/30';
  const bulbClass = neutral
    ? 'text-gray-400 dark:text-gray-500'
    : 'text-amber-500/80 dark:text-amber-400/70';
  const addHoverClass = neutral
    ? 'hover:text-violet-600 dark:hover:text-violet-400 focus-visible:ring-violet-400/50'
    : 'hover:text-amber-600 dark:hover:text-amber-400 focus-visible:ring-amber-400/50';

  const startEdit = () => {
    if (isReadOnly) return;
    blurSaveRef.current = true;
    openingText.current = note?.trim() || undefined;
    openedSave.current = captureSave?.();
    setText(note ?? '');
    setEditing(true);
  };
  const startEditRef = useRef(startEdit);
  startEditRef.current = startEdit;
  useEffect(() => { if (editSignal) startEditRef.current(); }, [editSignal]);
  const editingChangeRef = useRef(onEditingChange);
  editingChangeRef.current = onEditingChange;
  useEffect(() => { editingChangeRef.current?.(editing); }, [editing]);

  const commit = () => {
    if (awaitingCapture.current) return;
    const next = text.trim() || undefined;
    // The saved note can refresh while this field still displays the opening text.
    const capture = next !== openingText.current && next !== note ? (openedSave.current ?? onChange)(next) : undefined;
    if (!capture) {
      setEditing(false);
      return;
    }
    awaitingCapture.current = true;
    setCapturing(true);
    void capture.then(() => setEditing(false), () => undefined).finally(() => {
      awaitingCapture.current = false;
      setCapturing(false);
    });
  };

  const clearAfterAsking = async () => {
    const ticket = { text: note ?? '', save: captureSave?.() };
    askedRef.current = ticket;
    const confirmed = await confirm({
      title: labels?.deleteConfirm ?? { key: 'planEditor.note.deleteConfirm' },
      description: { said: ticket.text },
      confirmText: { key: 'common.delete' },
    });
    if (askedRef.current !== ticket) return;
    askedRef.current = null;
    const latest = latestRef.current;
    if (!confirmed) {
      clearButtonRef.current?.focus();
      return;
    }
    if (latest.isReadOnly || latest.note !== ticket.text) return;
    await Promise.resolve((ticket.save ?? latest.onChange)(undefined)).catch(() => undefined);
  };

  const cancel = () => {
    if (awaitingCapture.current) return;
    blurSaveRef.current = false; // the imminent blur must NOT save
    setEditing(false);
  };

  const commitFromBlur = () => {
    if (!blurSaveRef.current) {
      blurSaveRef.current = true;
      return;
    }
    commit();
  };

  if (editing) {
    return (
      <div className={`${indentClass} mt-1`}>
        <TextareaAutosize
          value={text}
          readOnly={capturing || isReadOnly}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitFromBlur}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              // Answered here: the window the note sits in stays open.
              e.stopPropagation();
              cancel();
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholderText}
          minRows={2}
          className={`w-full resize-none overflow-hidden rounded border focus:outline-none focus:ring-1 ${body ? 'px-2.5 py-1.5 text-base leading-snug md:text-sm' : 'px-2 py-1 text-xs'} ${editFieldClass}`}
          autoFocus
        />
        {editActions && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancel} disabled={capturing}
              className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700">
              {editActions.cancel}
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={commit} disabled={capturing}
              className="inline-flex h-9 items-center rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400">
              {editActions.save}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (note) {
    return (
      <>
        <div
          className={`${indentClass} flex items-start gap-1 ${body
            ? 'text-[15px] leading-snug text-gray-800 md:text-sm dark:text-gray-100'
            : 'mt-1 text-xs italic text-slate-500 dark:text-gray-400'} ${
            isReadOnly || !clickToEdit ? '' : body ? 'cursor-text' : 'cursor-text hover:text-slate-700 dark:hover:text-gray-300'
          }`}
          onClick={isReadOnly || !clickToEdit ? undefined : startEdit}
          title={isReadOnly || !clickToEdit ? undefined : labelText}
        >
          {!body && <LightBulbIcon className={`mt-px h-3 w-3 flex-shrink-0 not-italic ${bulbClass}`} />}
          <span className="min-w-0 flex-1 break-words whitespace-pre-wrap"><ScriptureText text={note} /></span>
          {!isReadOnly && !hideClearButton && (
            <button type="button"
              ref={clearButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                void clearAfterAsking();
              }}
              className="not-italic flex-shrink-0 rounded p-0.5 text-slate-300 hover:text-red-500 dark:text-gray-600 dark:hover:text-red-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400/50"
              aria-label={clearText}
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          )}
        </div>
        {/* The question is a portal, but React still bubbles its clicks through this tree:
            stop them here so answering it never reaches a host's click handler. Keys are left
            alone: Escape must reach the modal layer that closes the topmost window. */}
        <span className="contents" onClick={(e) => e.stopPropagation()}>
          {confirmDialog}
        </span>
      </>
    );
  }

  if (isReadOnly) return null;

  return (
    <button type="button"
      onClick={startEdit}
      className={`${indentClass} mt-1 inline-flex items-center gap-1 rounded text-xs text-slate-400 dark:text-gray-500 transition-colors focus:outline-none focus-visible:ring-1 ${addHoverClass} ${addRevealClass}`}
      aria-label={labelText}
    >
      <LightBulbIcon className="h-3 w-3" />
      <span>{addText}</span>
    </button>
  );
};

export default PointNote;
