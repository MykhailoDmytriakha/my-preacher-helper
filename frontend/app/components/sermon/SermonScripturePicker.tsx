'use client';

import { BookOpenIcon } from '@heroicons/react/24/outline';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { BookNavigator, type NavigatorProps } from '@/components/bible/BiblePicker';
import { readTranslation } from '@/components/bible/translation';
import { copyNamesOf } from '@/components/bible/verseCopy/useVerseCopy';
import { useRoomyHeader } from '@/hooks/useWideViewport';
import { resolveAppLocale } from '@/utils/appLocale';
import { fetchBookText } from '@/utils/bibleText';
import { copiedPlaceLine, passageCopyText } from '@/utils/verseCopy';
import { useTranslation } from '@locales/useTranslation';

import type { BibleId } from '@/utils/bibles';

export function SermonScripturePicker({ disabled, onPick }: { disabled: boolean; onPick: (verse: string) => void }) {
  const { t, language } = useTranslation();
  const locale = resolveAppLocale(language);
  const wide = useRoomyHeader();
  const trigger = useRef<HTMLButtonElement>(null);
  const selection = useRef<symbol | null>(null);
  const [bible, setBible] = useState<BibleId | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => () => { selection.current = null; }, []);

  const close = () => {
    selection.current = null;
    setPending(false);
    setBible(null);
  };

  const pick = async (book: string, { chapter, verse, toVerse = verse }: Parameters<NavigatorProps['onOpen']>[1]) => {
    if (!bible || disabled) return;
    const request = Symbol();
    selection.current = request;
    setPending(true);
    const names = copyNamesOf(bible, book, language, t);
    const passage = { chapter, toChapter: chapter, fromVerse: verse, toVerse };
    const bookText = await fetchBookText(book, bible).catch(() => null);
    if (selection.current !== request) return;

    const quote = bookText ? passageCopyText(bookText.chapters, passage, names) : '';
    if (quote) {
      onPick(quote);
    } else {
      const verses = Array.from({ length: toVerse - verse + 1 }, (_, offset) => ({ chapter, verse: verse + offset }));
      onPick(copiedPlaceLine(verses, names));
      toast.info(t('addSermon.referenceOnly'));
    }
    close();
  };

  return <>
    <button
      ref={trigger}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={bible !== null}
      disabled={disabled}
      onClick={(event) => {
        // Touch browsers can leave the previous text field focused when a button is tapped.
        event.currentTarget.focus({ preventScroll: true });
        setBible(readTranslation(locale));
      }}
      className="mt-1 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
    >
      <BookOpenIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {t('addSermon.chooseFromBible')}
    </button>
    {bible && <BookNavigator
      start="books" bookId="Genesis" bible={bible} currentChapter={1} currentVerse={1} text={null}
      locale={locale} wide={wide} anchorRef={trigger} choosing="verse" centered layerClassName="z-[140]"
      actionLabel={t('addSermon.usePassage')} autoFocusSearch={false} selectionPending={pending} onClose={close}
      onOpen={(book, place) => { void pick(book, place); }}
    />}
  </>;
}
