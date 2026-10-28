import { APOSTROPHES } from '@/utils/bibleBooks';

/**
 * HOW A WORD IS COMPARED in Bible search: lower case, «ё» as «е», apostrophes dropped («сім'я» is
 * «сімя», «Lord's» is «lords»), stress marks dropped (Ohienko prints «Па́стир»: a person types «пастир»).
 * A query and a verse are both read this way, so the two meet on one spelling whatever the keyboard
 * or the text printed. Only the stress marks go — «й» and «ї» are letters of their own and stay.
 */
const STRESS = /[\u0300\u0301]/g;
const WORD = /[\p{L}\p{N}]+/gu;

export const normalizeWord = (text: string): string => text.toLowerCase().replace(/ё/g, 'е').replace(APOSTROPHES, '').replace(STRESS, '');

/**
 * A search line as it is kept and recognised again — in the history, in the verses opened from it, in
 * «Показать ещё»: no spaces at the ends and one between words. «НЗ  благодать» and «НЗ благодать» are
 * one search (Codex review, 2026-10-23: three places each compared the line their own way).
 */
export const keptLine = (line: string): string => line.trim().replace(/\s+/g, ' ');

/** Which search a line is, compared as the search compares words: «НЗ всё» and «нз все» are one search. */
export const lineKey = (line: string): string => normalizeWord(keptLine(line));

/** The words of a text in their order, as compared. */
export const wordsOfText = (text: string): string[] => normalizeWord(text).match(WORD) ?? [];

/** A piece of a verse as shown: a word (with the form it is compared by) or what stands between words. */
export type TextPiece = { text: string; word: string | null };

/**
 * A verse cut into words and the signs between them, the original letters kept — to mark the found
 * words without their commas and quotes.
 */
export function piecesOfText(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const match of text.matchAll(/[\p{L}\p{M}\p{N}'’ʼ]+/gu)) {
    const at = match.index ?? 0;
    if (at > last) pieces.push({ text: text.slice(last, at), word: null });
    const word = normalizeWord(match[0]);
    pieces.push({ text: match[0], word: word || null });
    last = at + match[0].length;
  }
  if (last < text.length) pieces.push({ text: text.slice(last), word: null });
  return pieces;
}
