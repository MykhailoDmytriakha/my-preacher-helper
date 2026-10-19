import { getBookById, getLocalizedBookName } from './bibleBooks';
import { decodeCompleteBookMarks } from './bibleMarks';
import { isBibleId } from './bibles';

import type { AppLocale } from './appLocale';
import type { DocumentData } from '@/data-engine/types';

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** Display only a complete known marks value. Unknown evidence stays in the caller's raw fallback. */
export function bibleMarksRecoveryValue(t: Translate, locale: AppLocale, field: string, value: unknown, document?: DocumentData): unknown {
  if (field === 'bible' && isBibleId(value)) return t(`bible.translations.${value}.name`);
  if (field === 'book' && typeof value === 'string' && getBookById(value)) return getLocalizedBookName(value, locale);
  if (field !== 'verses' || !document || !isBibleId(document.bible)
    || typeof document.book !== 'string' || !getBookById(document.book)) return value;
  const marks = decodeCompleteBookMarks(value);
  if (!marks) return value;
  const book = getLocalizedBookName(document.book, locale);
  const places = Object.keys(marks).sort((a, b) => {
    const [ac, av] = a.split(':').map(Number), [bc, bv] = b.split(':').map(Number);
    return ac - bc || av - bv;
  });
  const lines = places.map(place => {
    const entry = marks[place];
    const runs = (['m', 'p'] as const).flatMap(layer => (entry[layer] ?? []).map(([first, last, color]) => {
      const meaning = color === 'gray' ? '' : t(`bible.marks.meaning.${color}`);
      const tool = layer === 'm' ? t('bible.marks.marker', { meaning })
        : color === 'gray' ? t('bible.marks.plainPencil') : t('bible.marks.pencil', { meaning });
      return `${tool} · ${t('bible.marks.words', { first: first + 1, last: last + 1 })}`;
    }));
    return `${book} ${place} — ${runs.join('; ')}`;
  });
  return [t(`bible.translations.${document.bible}.name`), ...lines.length ? lines : [`${book} — ${t('bible.marks.noMarks')}`]].join('\n');
}
