'use client';

import { MagnifyingGlassIcon, RectangleStackIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { resolveBibleLocale } from '@/(pages)/(private)/studies/bibleData';
import { formatScriptureRef } from '@/(pages)/(private)/studies/bookAbbreviations';
import { useStudyNoteDirectory } from '@/hooks/useSermonNoteLinks';
import { formatDateOnly } from '@/utils/dateFormatter';
import { compareById, timeOrZero } from '@/utils/sortHelpers';
import { matchesStudyNoteQuery } from '@/utils/studyNoteUtils';
import { SOURCE_NOTE_COLORS, UI_COLORS } from '@/utils/themeColors';

import type { SourceNoteSaveResult } from '@/hooks/useSermonNoteLinks';
import type { StudyNote } from '@/models/models';

/**
 * PICK THE NOTES A SERMON GREW OUT OF.
 *
 * Deliberately the same object as `AddSermonToSeriesModal` — portal, one overlay, a coloured
 * hairline at the top, search, a scrolling list of togglable rows — because it answers the
 * same kind of question and a second dialect of "choose a thing to link" would make the app
 * feel assembled from parts. What changes is the accent: this one is in the STUDIES colour,
 * so the dialog announces what you are choosing before you read a word of it.
 *
 * Rows show what a preacher recognises a note by — its title, its references, its tags — and
 * not its id or counts. Already-linked notes come pre-ticked, so the dialog is one control
 * for both adding and removing: what you leave ticked is what the sermon ends up with.
 *
 * WHAT THE SAVE ANSWER MEANS HERE. The writer reports four different things and the dialog
 * owes a different move to each: stored and queued-offline both mean the choice is kept, so it
 * closes; refused means the server holds a different list, so it ADOPTS that list and stays
 * open — pressing the same button against the same stale baseline could otherwise be refused
 * for ever.
 */
interface SourceNotePickerModalProps {
  /** Notes the sermon was linked to WHEN THIS DIALOG OPENED. */
  selectedNoteIds: string[];
  /** Persist the list. The opening revision/baseline is owned by the caller — see the hook. */
  onSave: (noteIds: string[]) => Promise<SourceNoteSaveResult>;
  onClose: () => void;
  saving?: boolean;
  /**
   * The control that opened this dialog. Focus goes back to it on close — reading
   * `document.activeElement` here cannot work, because the menu holding that control has
   * already unmounted by the time this mounts, leaving `body` as the "previous" focus.
   */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

export default function SourceNotePickerModal({
  selectedNoteIds,
  onSave,
  onClose,
  saving = false,
  returnFocusTo,
}: SourceNotePickerModalProps) {
  const { t, i18n } = useTranslation();
  const { notes, loading, ready } = useStudyNoteDirectory();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedNoteIds));
  /** Did the person actually touch the ticks? Decides whether Save has anything to say. */
  const [dirty, setDirty] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  /**
   * KEYBOARD OWNERSHIP. The control that opened this dialog unmounts with the menu, so without
   * an explicit move focus is left on nothing: Tab then walks the page BEHIND an `aria-modal`
   * overlay. Focus goes to the search field (the first thing anyone does here is look for a
   * note), stays inside while the dialog lives, and returns to whatever had it before.
   */
  useEffect(() => {
    if (!mounted) return;
    // Captured at MOUNT, both of them: reading the ref during cleanup can find an element that
    // has since unmounted or now belongs to a different row, which is how focus ends up on the
    // wrong control instead of back where it came from.
    const opener = returnFocusTo?.current ?? null;
    const fallback = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => {
      // Connected is not enough: the opener can be DISABLED by the time this closes (a pending
      // sync disables the menu button), and focusing a disabled control does nothing at all —
      // focus would silently land on `body`.
      const usable = (node: HTMLElement | null): boolean =>
        !!node &&
        node.isConnected &&
        typeof node.focus === 'function' &&
        !(node as HTMLButtonElement).disabled;
      [opener, fallback].find(usable)?.focus();
    };
  }, [mounted, returnFocusTo]);

  // Escape listens on the DOCUMENT, not on the dialog: it must work even if focus has drifted
  // out (a click on the overlay, an extension stealing focus), and a dialog that can only be
  // dismissed while focus happens to be inside is a trap.
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      // Never while a save is in flight: the answer decides whether this dialog closes or
      // stays with the choice on screen, and it cannot do either once it is gone.
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose, saving]);

  /**
   * TAB STAYS INSIDE, even when the element that had focus disappeared.
   *
   * Rows come and go here — a removed "deleted note" row, a "Unlink all" button that vanishes
   * at zero — and whatever had focus unmounts with them. Focus then falls to `body`, which is
   * OUTSIDE the dialog, so a handler bound to the dialog would never see the next Tab. Bound
   * to the document, it can pull focus back in.
   */
  useEffect(() => {
    if (!mounted) return;
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (!dialog.contains(document.activeElement)) {
        // Focus already escaped — usually because the element holding it unmounted.
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      // Still inside: wrap at the edges, or the browser's default action would step off the
      // last control and out of the dialog before any of this could react.
      // No visibility filtering: `offsetParent` is always null in jsdom, so a filter written
      // that way would collapse the ring to a single element in tests and silently stop
      // guarding anything.
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, [mounted]);

  const bibleLocale = useMemo(() => resolveBibleLocale(i18n.language), [i18n.language]);

  const tokens = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  const visibleNotes = useMemo(() => {
    const matching = notes.filter((note) => matchesStudyNoteQuery(note, tokens, bibleLocale));
    // Linked notes first, then most recently touched: the ones this sermon already stands on
    // must never be somewhere down a scrolling list, because this dialog is also how they are
    // removed.
    return [...matching].sort((a, b) => {
      const aLinked = selected.has(a.id) ? 0 : 1;
      const bLinked = selected.has(b.id) ? 0 : 1;
      if (aLinked !== bLinked) return aLinked - bLinked;
      // `timeOrZero` + `compareById` are the repository's own comparator pair: a missing or
      // malformed date would otherwise make the sort non-deterministic, and equal dates would
      // shuffle rows between renders.
      const byRecency = timeOrZero(b.updatedAt) - timeOrZero(a.updatedAt);
      return byRecency !== 0 ? byRecency : compareById(a, b);
    });
  }, [notes, tokens, bibleLocale, selected]);

  /**
   * SELECTED IDS THAT NO LONGER EXIST — a note deleted after it was linked.
   *
   * They get their own row, because without one the footer counts two while the list shows
   * one, and the only way to clear the dead id is "unlink all", which also throws away the
   * good links. Computed only once the directory has actually loaded: mid-load every id looks
   * missing.
   */
  const missingIds = useMemo(() => {
    // `ready` is the whole point: a failed or in-flight read returns an empty list, and calling
    // every linked note "deleted" on that basis would invite unlinking notes that exist.
    if (!ready) return [];
    const known = new Set(notes.map((note) => note.id));
    return [...selected].filter((id) => !known.has(id));
  }, [selected, notes, ready]);

  const toggle = (noteId: string) => {
    // While a save is in flight the writer already holds the list it was given; a later tick
    // would be lost the moment a successful answer closes this dialog.
    if (saving) return;
    setDirty(true);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const handleSave = async () => {
    // Nothing was touched: there is nothing to say to the server, and saying it anyway would
    // move the sermon's revision and make every other device see a change that did not happen.
    if (!dirty) {
      onClose();
      return;
    }
    const result = await onSave(Array.from(selected));
    if (result.outcome === 'stale') {
      // The server's list is now the truth this dialog works from, so a deliberate second
      // press means "mine wins" instead of hitting the same refusal again.
      setSelected(new Set(result.serverNoteIds ?? []));
      // The adopted list is the server's, not a choice of the person's — the next press has to
      // mean something again.
      setDirty(false);
      return;
    }
    if (result.outcome === 'failed') return;
    onClose();
  };

  const noteTitle = (note: StudyNote) => note.title?.trim() || t('studiesWorkspace.untitled');

  const content = (
    <div
      className="fixed inset-0 z-[100] flex bg-black/60 backdrop-blur-sm sm:items-center sm:justify-center sm:px-4"
    >
      {/*
        MOBILE IS FULL-SCREEN ON PURPOSE. A capped-height card with a list scrolling inside it
        is what the repository's own rule warns about: on a phone the touch lands in the inner
        box and the page under it refuses to move. Full-screen with ONE scroll region (this
        list) behaves like every other mobile sheet; the centred card returns from `sm` up.
      */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('sermon.sourceNotes.picker.title')}
        className="flex h-full w-full flex-col overflow-hidden border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800 sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl sm:border"
      >
        <div className={`h-1 w-full shrink-0 ${SOURCE_NOTE_COLORS.dialogAccentBar}`} />
        <div className="flex flex-1 flex-col overflow-hidden p-5 sm:p-7">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${SOURCE_NOTE_COLORS.dialogEyebrow}`}
              >
                <RectangleStackIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t('sermon.sourceNotes.picker.eyebrow')}
              </p>
              <h2 className="mt-3 text-xl font-semibold text-gray-900 dark:text-gray-50">
                {t('sermon.sourceNotes.picker.title')}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t('sermon.sourceNotes.picker.description')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              aria-label={t('sermon.sourceNotes.picker.cancel')}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <div className="relative mb-4">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('sermon.sourceNotes.picker.searchPlaceholder')}
              aria-label={t('sermon.sourceNotes.picker.searchPlaceholder')}
              className={`w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${SOURCE_NOTE_COLORS.searchFocus}`}
            />
          </div>

          <div className="-mx-1 flex-1 overflow-y-auto px-1">
            {loading && notes.length === 0 ? (
              <ul className="space-y-2" aria-hidden="true">
                {[0, 1, 2].map((row) => (
                  <li key={row} className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
                ))}
              </ul>
            ) : notes.length === 0 && missingIds.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('sermon.sourceNotes.picker.empty')}
              </p>
            ) : visibleNotes.length === 0 && missingIds.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                {t('sermon.sourceNotes.picker.noMatches')}
              </p>
            ) : (
              <ul className="space-y-2">
                {missingIds.map((id) => (
                  <li key={id} data-testid="missing-note-row">
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border border-dashed p-3 transition-colors ${SOURCE_NOTE_COLORS.rowIdle}`}
                    >
                      <input
                        type="checkbox"
                        checked
                        onChange={() => toggle(id)}
                        disabled={saving}
                        aria-label={t('sermon.sourceNotes.picker.deletedNote')}
                        className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 dark:border-gray-600 ${SOURCE_NOTE_COLORS.checkbox}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-gray-500 line-through dark:text-gray-400">
                          {t('sermon.sourceNotes.picker.deletedNote')}
                        </span>
                        <span className="mt-1 block text-xs text-gray-400 dark:text-gray-500">
                          {t('sermon.sourceNotes.picker.deletedNoteHint')}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
                {visibleNotes.map((note) => {
                  const isSelected = selected.has(note.id);
                  return (
                    <li key={note.id}>
                      <label
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
                          isSelected ? SOURCE_NOTE_COLORS.rowSelected : SOURCE_NOTE_COLORS.rowIdle
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(note.id)}
                          disabled={saving}
                          className={`mt-1 h-4 w-4 shrink-0 rounded border-gray-300 dark:border-gray-600 ${SOURCE_NOTE_COLORS.checkbox}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                            {noteTitle(note)}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                            {(note.scriptureRefs ?? []).slice(0, 3).map((ref) => (
                              <span
                                key={ref.id}
                                className={`rounded-md px-1.5 py-0.5 ${SOURCE_NOTE_COLORS.refChip}`}
                              >
                                {formatScriptureRef(ref, bibleLocale)}
                              </span>
                            ))}
                            {(note.tags ?? []).slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded-md bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
                                {tag}
                              </span>
                            ))}
                            <span className="ml-auto shrink-0">{formatDateOnly(note.updatedAt)}</span>
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
            <div
              className={`flex items-center gap-3 text-sm ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText}`}
            >
              <span data-testid="source-note-selected-count">
                {t('sermon.sourceNotes.picker.selected', { count: selected.size })}
              </span>
              {selected.size > 0 && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDirty(true);
                    setSelected(new Set());
                  }}
                  className="text-sm font-medium text-gray-500 underline-offset-2 transition-colors hover:text-red-600 hover:underline dark:text-gray-400 dark:hover:text-red-400"
                >
                  {t('sermon.sourceNotes.picker.clear')}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('sermon.sourceNotes.picker.cancel')}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${SOURCE_NOTE_COLORS.primaryButton}`}
              >
                {saving ? t('common.saving') : t('sermon.sourceNotes.picker.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(content, document.body);
}
