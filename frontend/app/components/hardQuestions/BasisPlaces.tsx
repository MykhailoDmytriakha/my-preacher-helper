'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useScriptureLinks } from '@/components/bible/ScriptureLinks';
import { BASIS_DOT, basisPath, SCRIPTURE_TEXT } from '@/components/hardQuestions/parts';
import { useAppLocale } from '@/hooks/useAppLocale';
import { readablePlaces } from '@/utils/hardQuestions';
import { placeShown } from '@/utils/placeText';
import { referenceBibleFor } from '@/utils/scriptureReferenceNumbering';
import { useTranslation } from '@locales/useTranslation';

import type { SheetReference } from '@/components/bible/verseSheetGeometry';
import type { HardQuestionBasis } from '@/models/models';

/** Places shown at once; the rest wait behind «ещё N». */
const PLACES_SHOWN = 4;

/**
 * A BASIS'S PLACES OF SCRIPTURE, WHEREVER THE BASIS IS LISTED — the section's list of themes, a theme's page. Each
 * place is read in the reader's Bible and pressed opens it over the page in the page's verse window
 * (`ScriptureLinksInWindow`), like every other reference in the app (the owner, 2026-11-26: «стих должен быть
 * кликабельным, как и другие»). An entry no Bible can open («Рим 25») stays a plain word; a basis with no place
 * says so. Inside a card that is one link, the row is put above it with `pointer-events-none`: the places take the
 * press, the space between them still opens the card.
 */
export function BasisPlaces({ refs, className = '' }: { refs: readonly string[] | undefined; className?: string }) {
  const { t } = useTranslation();
  const { locale } = useAppLocale();
  const links = useScriptureLinks();
  const bible = referenceBibleFor(locale);
  const [all, setAll] = useState(false);
  const { places, unread } = useMemo(() => {
    const kept: SheetReference[] = [];
    const unreadable: string[] = [];
    for (const ref of refs ?? []) {
      const found = readablePlaces(ref, locale);
      if (found.length) kept.push(...found);
      else unreadable.push(ref);
    }
    return { places: kept, unread: unreadable };
  }, [refs, locale]);
  if (!places.length && !unread.length) {
    // A basis kept before every basis had to stand on a place (2026-11-26): it says so, to be given one.
    return <span className={`inline-flex min-h-7 items-center text-[13px] text-gray-500 dark:text-gray-400 ${className}`}>{t('hardQuestions.theme.noPlaces')}</span>;
  }
  const shown = all ? places : places.slice(0, PLACES_SHOWN);
  const rest = places.length - shown.length;
  return (
    <span className={`-ml-1.5 flex min-w-0 flex-wrap items-center ${className}`}>
      {shown.map((place, index) => {
        const name = placeShown(place, bible, { text: undefined, locale }).name;
        return (
          <span key={`${index}:${name}`} className="inline-flex items-center">
            {index > 0 && <span aria-hidden="true" className="px-0.5 text-gray-300 dark:text-gray-600">·</span>}
            <button type="button" onClick={() => links?.onOpen(place)} aria-label={t('hardQuestions.question.openPlace', { place: name })}
              className={`pointer-events-auto inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-1.5 text-[13.5px] font-medium sm:min-h-7 ${SCRIPTURE_TEXT} hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:hover:bg-indigo-950/40`}>
              {name}
            </button>
          </span>
        );
      })}
      {rest > 0 && (
        <span className="inline-flex items-center">
          <span aria-hidden="true" className="px-0.5 text-gray-300 dark:text-gray-600">·</span>
          <button type="button" onClick={() => setAll(true)}
            className="pointer-events-auto inline-flex min-h-9 items-center rounded-md px-1.5 text-[13px] text-gray-500 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 sm:min-h-7 dark:text-gray-400 dark:hover:bg-gray-800">
            {t('hardQuestions.theme.morePlaces', { count: rest })}
          </button>
        </span>
      )}
      {unread.map((ref) => <span key={ref} className="px-1.5 text-[13px] text-gray-500 dark:text-gray-400">{ref}</span>)}
    </span>
  );
}

/**
 * One basis in a list — a theme in the section's list, the bases a question rests on: its name to its page, and its
 * places (`BasisPlaces`), beside it on a wide screen, under it on a phone.
 */
export function BasisLine({ themeId, basis }: { themeId: string; basis: HardQuestionBasis }) {
  return (
    <li className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-start sm:gap-5 sm:py-1.5">
      <Link href={basisPath(themeId, basis.id)}
        className="flex min-h-7 items-center gap-2 rounded text-sm font-semibold text-gray-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 sm:w-[17.5rem] sm:shrink-0 dark:text-gray-100">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BASIS_DOT}`} aria-hidden="true" />
        <span className="min-w-0">{basis.title}</span>
      </Link>
      <BasisPlaces refs={basis.scriptureRefs} className="flex-1 pl-3.5 sm:pl-0" />
    </li>
  );
}
