import { verseWords } from '@/utils/bibleText';

import type { BookText } from '@/utils/bibleText';
import type { TFunction } from 'i18next';

export function markLocation(verseKey: string, first: number, last: number, text: BookText | null) {
  const [chapter, verse] = verseKey.slice(1).split('_').map(Number);
  const raw = text?.chapters[chapter - 1]?.[verse - 1];
  const words = raw ? verseWords(raw).split(/\s+/).filter(Boolean).slice(first, last + 1).join(' ') : '';
  return { verse: chapter + ':' + verse, words };
}

export function markName(t: TFunction, colour: string | null) {
  if (colour === null) return t('bible.marks.historyErased');
  return colour === 'gray' ? t('bible.marks.plainPencil') : t(`bible.marks.meaning.${colour}`);
}
