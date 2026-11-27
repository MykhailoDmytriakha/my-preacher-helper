'use client';

import { useMemo, type ReactNode } from 'react';

import { PlaceCard, placeWords } from '@/components/bible/PlaceCard';
import { useScriptureLinks } from '@/components/bible/ScriptureLinks';
import { useBookTexts } from '@/components/bible/useBookTexts';
import { Chip } from '@/components/ui/Chip';
import { useAppLocale } from '@/hooks/useAppLocale';
import { referencesInText } from '@/utils/bibleLink';
import { readablePlaces } from '@/utils/hardQuestions';
import { placeShown } from '@/utils/placeText';
import { referenceBibleFor, versesHeldIn } from '@/utils/scriptureReferenceNumbering';
import { useTranslation } from '@locales/useTranslation';

import { ListLabel } from './parts';

import type { SheetReference } from '@/components/bible/verseSheetGeometry';

/** Two writings of the same verses are one place: «1 Тим 2:9» typed and «(1 Тим 2:9)» in the answer. */
const placeKey = (place: SheetReference): string =>
  versesHeldIn(place, 'kjv').map((verse) => `${verse.book}:${verse.chapter}:${verse.verse}`).join('|')
  || `${place.book}:${place.chapter ?? ''}`;

/**
 * THE PLACES OF SCRIPTURE AN ANSWER STANDS ON — each with its words in the reader's Bible, so the
 * pastor reads them right here; a press opens the place over the page with the way on into the
 * Bible (the page's `ScriptureLinksInWindow`). The places are the ones he listed, then every place
 * his answer names in its words — one copy of each reference, the one he wrote (`placesOf`).
 * A listed entry the app cannot read («Рим 25») stays a label rather than vanish. `chapter` heads it as a chapter
 * with its count, like the theme's sections; `empty` is what it says when no place is named (a basis must have one).
 */
export function ScripturePlaces({ title, refs, texts, chapter = false, empty }: {
  title: string; refs: readonly string[]; texts: readonly (string | undefined)[]; chapter?: boolean; empty?: ReactNode;
}) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const links = useScriptureLinks();
  const bible = referenceBibleFor(locale);
  const { places, unread } = useMemo(() => {
    const seen = new Set<string>();
    const kept: SheetReference[] = [];
    const unreadable: string[] = [];
    const keep = (place: SheetReference) => {
      const key = placeKey(place);
      if (seen.has(key)) return;
      seen.add(key);
      kept.push(place);
    };
    for (const ref of refs) {
      // An entry may list several places («1 Кор 11:4, 14»): each is its own card, and nothing is read as a span.
      const places = readablePlaces(ref, locale);
      if (places.length) places.forEach(keep);
      else unreadable.push(ref);
    }
    for (const text of texts) if (text) for (const found of referencesInText(text, locale)) keep(found.reference);
    return { places: kept, unread: unreadable };
  }, [refs, texts, locale]);
  const books = useMemo(() => [...new Set(places.map((place) => place.book))], [places]);
  const bookTexts = useBookTexts(books, bible);

  const count = places.length + unread.length;
  const heading = chapter
    ? <ListLabel chapter title={title} count={count} countLabel={t('hardQuestions.counts.places', { count })} />
    : <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{title}</h2>;
  // No place named anywhere: the section says nothing rather than show an empty heading — or says `empty`.
  if (!count) return empty ? <section aria-label={title}>{heading}{empty}</section> : null;
  return (
    <section aria-label={title}>
      {heading}
      <div className={`${chapter ? 'mt-2.5' : 'mt-3'} flex flex-col gap-2.5`}>
      {places.map((place) => {
        const shown = placeShown(place, bible, { text: bookTexts.get(place.book), locale });
        return (
          <PlaceCard key={placeKey(place)} tone="indigo" label={shown.name} note={null}
            words={placeWords(shown.verses, place)} loadingWords={t('hardQuestions.question.placeLoading')}
            openLabel={t('hardQuestions.question.openPlace', { place: shown.name })}
            onOpen={() => links?.onOpen(place)} />
        );
      })}
      {unread.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {unread.map((ref) => <Chip key={ref} tone="neutral" size="sm">{ref}</Chip>)}
        </div>
      )}
      </div>
    </section>
  );
}
