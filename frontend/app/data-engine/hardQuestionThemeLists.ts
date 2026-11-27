import { APP_LOCALES } from '@/utils/appLocale';
import { standsOnScripture } from '@/utils/hardQuestions';

import { equalValues, object } from './fieldValues';

import type { FieldValue } from './types';

export const HARD_QUESTION_BASIS_SCRIPTURE = 'hard-question-basis-scripture';

export function hardQuestionThemeListPath(path: readonly string[]): boolean {
  return path.length === 1 && (path[0] === 'groups' || path[0] === 'bases');
}

export function hardQuestionBasisScriptureId(path: readonly string[]): string | undefined {
  if (path.length === 3 && path[0] === 'bases' && path[1].startsWith('id:') && path[2] === 'scriptureRefs') {
    return path[1].slice('id:'.length) || undefined;
  }
}

export function hasBasisScripture(value: unknown): boolean {
  return Array.isArray(value) && value.every((item): item is string => typeof item === 'string')
    && APP_LOCALES.some(locale => standsOnScripture(value, locale));
}

/** Two individually valid edits can remove every place when combined. */
export function reviewMergedBasisScripture(path: readonly string[], mine: FieldValue, stored: FieldValue, merged: FieldValue): boolean {
  return Boolean(hardQuestionBasisScriptureId(path))
    && hasBasisScripture(mine.value) && hasBasisScripture(stored.value) && !hasBasisScripture(merged.value);
}

/** Existing rows can keep their original data even while other rows are edited or rearranged. */
export function keepsBasisScripture(previous: unknown, proposed: unknown): boolean {
  if (!Array.isArray(proposed)) return true;
  const old = Array.isArray(previous) ? previous.filter(object) : [];
  return proposed.every(row => object(row) && (hasBasisScripture(row.scriptureRefs)
    || old.some(opening => opening.id === row.id && equalValues(opening, row))));
}
