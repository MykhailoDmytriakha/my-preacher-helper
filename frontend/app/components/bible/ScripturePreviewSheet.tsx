'use client';

import { ArrowLeftIcon, ArrowRightIcon, ChevronRightIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FoldableMarkdown } from '@/components/ui/FoldableMarkdown';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useScriptureUsage } from '@/hooks/useScriptureUsage';
import { cssHighlightRegistry } from '@/utils/cssHighlights';
import { formatScriptureReference, type ScriptureRefShape } from '@/utils/scriptureReference';
import { referenceBibleFor } from '@/utils/scriptureReferenceNumbering';

import { ReaderSheet, SheetCloseButton } from './ReaderSheet';
import { VerseSheet } from './VerseSheet';

import type { ScriptureUsage } from '@/utils/scriptureUsage';

const MENTION_HIGHLIGHT = 'scripture-mention';

/**
 * Brings the place a previewed note names the passage into view and paints it (`globals.css`), so a
 * long note is not searched by eye. A note that names the passage only in its reference list opens
 * at the top, as before.
 */
function useMentionInView(body: HTMLElement | null, mention: string | undefined) {
  useEffect(() => {
    if (!body || !mention) return;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(mention) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + mention.length);
      centreInView(range, node.parentElement);
      const api = cssHighlightRegistry();
      if (!api) return;
      api.highlights.set(MENTION_HIGHLIGHT, new api.Highlight(range));
      return () => api.highlights.delete(MENTION_HIGHLIGHT);
    }
  }, [body, mention]);
}

/** The words themselves to the middle of the sheet that scrolls them: a long paragraph centred whole could leave them off screen. */
function centreInView(range: Range, element: HTMLElement | null) {
  // Only the preview sheet scrolls here, never the note beneath it.
  const pane = element?.closest<HTMLElement>('[role="dialog"]');
  const words = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
  if (!pane || !words?.height) {
    element?.scrollIntoView({ block: 'center' });
    return;
  }
  pane.scrollTop += words.top - pane.getBoundingClientRect().top - (pane.clientHeight - words.height) / 2;
}

/** Personal notes supplement the existing Bible window; this component never draws Bible text. */
export function ScripturePreviewSheet({ reference, currentNoteId, onClose }: {
  reference: ScriptureRefShape; currentNoteId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const usage = useScriptureUsage(reference, currentNoteId, locale);
  const [selected, setSelected] = useState<ScriptureUsage | null>(null);
  const [noteBody, setNoteBody] = useState<HTMLDivElement | null>(null);
  useMentionInView(noteBody, selected?.mention);
  const detailId = useId();
  const sheetReference = useMemo(() => ({ ...reference, bible: reference.bible ?? referenceBibleFor(locale) }), [reference, locale]);
  const untitled = t('bible.preview.untitled');

  return <VerseSheet
    reference={sheetReference}
    onClose={onClose}
    // The count shows once the search has finished, also from an incomplete list: the panel says it may be incomplete.
    related={{ label: t('bible.preview.myNotes'), count: usage.loading ? undefined : usage.results.length, render: returnToText => <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('bible.preview.notesForPassage')}</h3>
        <span className="text-xs text-gray-500 dark:text-gray-400">{formatScriptureReference(reference, { locale })}</span>
      </div>
      <div aria-live="polite">
        {usage.loading && <p role="status" className="py-4 text-sm text-gray-500 dark:text-gray-400">{t('bible.preview.loadingNotes')}</p>}
        {usage.error && <div className="py-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">{t('bible.preview.notesError')}</p>
          <button type="button" onClick={() => { void usage.retry(); }} className="min-h-11 text-sm font-medium text-indigo-700 dark:text-indigo-300">{t('bible.retry')}</button>
        </div>}
        {!usage.complete && !usage.loading && <p className="mt-3 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-600 dark:bg-gray-800 dark:text-gray-300">{t('bible.preview.partialNotes')}</p>}
        {!usage.loading && !usage.error && !usage.results.length && <p className="py-6 text-sm text-gray-500 dark:text-gray-400">{t(usage.complete ? 'bible.preview.emptyNotes' : 'bible.preview.emptyPartialNotes')}</p>}
        <ul className="mt-4 divide-y divide-gray-100 dark:divide-gray-800">{usage.results.map(item => <li key={item.id}>
          <button type="button" onClick={() => setSelected(item)} className="flex min-h-11 w-full items-start gap-3 rounded-xl px-2 py-4 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800">
            <DocumentTextIcon className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden="true" />
            <span className="min-w-0 flex-1 break-words">
              <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{item.title || untitled}</span>
              <span className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{item.excerpt}</span>
              <span className="mt-2 block text-xs text-indigo-700 dark:text-indigo-300">{formatScriptureReference(item.reference, { locale })} · {t(`bible.preview.matches.${item.match}`)}</span>
            </span>
            <ChevronRightIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        </li>)}</ul>
      </div>
      <p className="pt-5 text-xs text-gray-500 dark:text-gray-400">{t('bible.preview.excludesCurrent')}</p>
      {selected && <ReaderSheet titleId={detailId} onClose={() => setSelected(null)} layerClassName="z-[260]">
        <div className="flex items-start justify-between gap-2">
          <button type="button" onClick={() => { setSelected(null); returnToText(); }} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />{t('bible.preview.backToVerse')}
          </button>
          <SheetCloseButton onClose={() => setSelected(null)} />
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">{formatScriptureReference(selected.reference, { locale })}</p>
        <h2 id={detailId} className="mt-2 break-words text-xl font-semibold text-gray-900 dark:text-gray-50">{selected.title || untitled}</h2>
        <div ref={setNoteBody} className="my-5 break-words text-base leading-relaxed text-gray-800 dark:text-gray-200">
          <FoldableMarkdown content={selected.content} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-200 pt-3 dark:border-gray-700">
          <button type="button" onClick={() => setSelected(null)} className="min-h-11 text-sm font-medium text-indigo-700 dark:text-indigo-300">{t('bible.preview.backToNotes')}</button>
          {/* Here, not in a new tab: the installed app would hand a new tab to Safari, signed out. */}
          <Link href={selected.href} onClick={onClose} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">{t('bible.preview.openNote')}<ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></Link>
        </div>
      </ReaderSheet>}
    </> }}
  />;
}
