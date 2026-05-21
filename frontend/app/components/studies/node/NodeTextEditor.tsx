'use client';

import { LinkIcon } from '@heroicons/react/24/outline';
import { type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import WikilinkPicker from '@/(pages)/(private)/studies/components/WikilinkPicker';
import { useClickOutside } from '@/hooks/useClickOutside';
import { RichMarkdownEditor } from '@components/ui/RichMarkdownEditor';

import Wikilink from './wikilinkExtension';

interface NodeTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onPastePlainText?: (text: string) => boolean;
  placeholder?: string;
  minHeight?: string;
  /** Excluded from picker results so a note can't link to itself. */
  currentNoteId?: string;
}

interface PickerState {
  open: boolean;
  position?: { top: number; left: number };
  /** doc position where `[[` starts (or caret if opened via toolbar button). */
  rangeStart: number;
  /** doc position of the caret when the picker opened. */
  rangeEnd: number;
}

// Matches the `[[query` typed-so-far portion immediately before the caret.
const TRIGGER_PATTERN = /\[\[([A-Za-z0-9_-]*)$/;

// Width of the picker popup (must match WikilinkPicker's own width so the
// right-edge clamp doesn't go off-screen).
const PICKER_WIDTH = 336;
const PICKER_HEIGHT_BUDGET = 80;
const VIEWPORT_PADDING = 8;

function clampPickerPosition(top: number, left: number): { top: number; left: number } {
  return {
    top: Math.max(VIEWPORT_PADDING, Math.min(top, window.innerHeight - PICKER_HEIGHT_BUDGET)),
    left: Math.max(VIEWPORT_PADDING, Math.min(left, window.innerWidth - PICKER_WIDTH)),
  };
}

/**
 * Thin wrapper around RichMarkdownEditor that re-introduces the wikilink
 * picker after the move from textarea to tiptap. Listens to selection updates,
 * detects an open `[[…` at the caret, and opens the existing WikilinkPicker
 * positioned at the caret. Selecting a note inserts `[[noteId]] ` over the
 * `[[query` range using tiptap's `insertContentAt`.
 *
 * A toolbar button is also provided so users who don't know the `[[` trigger
 * can still pick a link from the menu.
 */
export function NodeTextEditor({
  value,
  onChange,
  onBlur,
  onPastePlainText,
  placeholder,
  minHeight,
  currentNoteId,
}: NodeTextEditorProps) {
  const wikilinkExtensions = useMemo(() => [Wikilink.configure()], []);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [picker, setPicker] = useState<PickerState>({ open: false, rangeStart: 0, rangeEnd: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const closePicker = useCallback(() => {
    setPicker((current) => (current.open ? { ...current, open: false } : current));
  }, []);

  // Recompute caret coords on scroll/resize so the picker stays anchored to
  // the `[[` trigger as the user pans the page. capture=true catches scroll
  // events from any ancestor scrollable. rAF-coalesced so smooth-scroll
  // doesn't trigger 60+ setStates/sec.
  useEffect(() => {
    if (!editor || !picker.open) return undefined;

    let rafId = 0;
    const reposition = (): void => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        try {
          const coords = editor.view.coordsAtPos(picker.rangeEnd);
          setPicker((current) => {
            if (!current.open) return current;
            return {
              ...current,
              position: clampPickerPosition(coords.bottom + 6, coords.left),
            };
          });
        } catch {
          // Caret position is no longer in the document (e.g. content shrunk).
          closePicker();
        }
      });
    };

    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [editor, picker.open, picker.rangeEnd, closePicker]);

  useClickOutside([wrapperRef, pickerRef], closePicker, { enabled: picker.open });

  useEffect(() => {
    if (!editor) return undefined;

    const detect = (): void => {
      const { from, to, empty } = editor.state.selection;
      if (!empty || from !== to) {
        closePicker();
        return;
      }
      // Look at the last 64 chars before the caret — enough for a wikilink
      // query, cheap to scan, and avoids walking the whole document.
      const lookbackStart = Math.max(0, from - 64);
      const before = editor.state.doc.textBetween(lookbackStart, from, '\n', '\n');
      const match = TRIGGER_PATTERN.exec(before);
      if (!match) {
        closePicker();
        return;
      }
      const coords = editor.view.coordsAtPos(from);
      setPicker({
        open: true,
        position: clampPickerPosition(coords.bottom + 6, coords.left),
        rangeStart: from - match[0].length,
        rangeEnd: from,
      });
    };

    editor.on('selectionUpdate', detect);
    editor.on('update', detect);
    return () => {
      editor.off('selectionUpdate', detect);
      editor.off('update', detect);
    };
  }, [editor, closePicker]);

  const handlePick = useCallback((noteId: string): void => {
    if (!editor) return;
    const insertion = `[[${noteId}]] `;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: picker.rangeStart, to: picker.rangeEnd }, insertion)
      .run();
    closePicker();
  }, [editor, picker.rangeStart, picker.rangeEnd, closePicker]);

  const handleOpenToolbarPicker = useCallback((): void => {
    if (!editor) return;
    const { from } = editor.state.selection;
    const coords = editor.view.coordsAtPos(from);
    setPicker({
      open: true,
      position: clampPickerPosition(coords.bottom + 6, coords.left),
      // No `[[` typed yet — pick result will simply insert at the caret.
      rangeStart: from,
      rangeEnd: from,
    });
    editor.commands.focus();
  }, [editor]);

  return (
    <div ref={wrapperRef} className="relative">
      <RichMarkdownEditor
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onPastePlainText={onPastePlainText}
        placeholder={placeholder}
        minHeight={minHeight}
        extraExtensions={wikilinkExtensions}
        onEditorReady={setEditor}
      />
      <button
        type="button"
        title="Вставить ссылку на заметку"
        aria-label="Вставить ссылку на заметку"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleOpenToolbarPicker}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" /> Ссылка
      </button>
      {picker.open ? (
        <div ref={pickerRef}>
          <WikilinkPicker
            open
            position={picker.position}
            currentNoteId={currentNoteId}
            onPick={handlePick}
            onClose={closePicker}
          />
        </div>
      ) : null}
    </div>
  );
}

export default NodeTextEditor;
