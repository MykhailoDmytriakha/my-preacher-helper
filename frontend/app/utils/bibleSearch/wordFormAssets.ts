import assets from './wordFormsData/assets.json';

export type WordFormLanguage = 'ru' | 'uk';
export type WordFormData = {
  schema: number;
  language: WordFormLanguage;
  paradigms: readonly string[];
  entries: readonly (readonly [lemma: string, stem: string, paradigm: number])[];
};

export const WORD_FORMS_CACHE = 'bible-word-forms-v1';
export const wordFormAsset = (language: WordFormLanguage) => assets.languages[language];
export const wordFormDataUrl = (language: WordFormLanguage): string => `/bible-word-forms/${wordFormAsset(language).file}`;

/** A cached or downloaded answer must be this complete language payload, never an HTML fallback or another language. */
export function isWordFormData(value: unknown, language: WordFormLanguage): value is WordFormData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<WordFormData>;
  const expected = wordFormAsset(language);
  return data.schema === 1 && data.language === language
    && Array.isArray(data.paradigms) && data.paradigms.length === expected.paradigms
    && data.paradigms.every(line => typeof line === 'string')
    && Array.isArray(data.entries) && data.entries.length === expected.entries
    && data.entries.every(entry => Array.isArray(entry) && entry.length === 3
      && typeof entry[0] === 'string' && typeof entry[1] === 'string'
      && Number.isInteger(entry[2]) && entry[2] >= 0 && entry[2] < expected.paradigms);
}
