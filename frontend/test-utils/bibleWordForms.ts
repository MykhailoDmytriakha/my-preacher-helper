import fs from 'node:fs';
import path from 'node:path';

import { wordFormDataUrl, type WordFormData, type WordFormLanguage } from '@/utils/bibleSearch/wordFormAssets';
import { loadWordFormLexicon } from '@/utils/bibleSearch/wordFormLexicon';

export function readWordFormFixture(language: WordFormLanguage): WordFormData {
  const file = path.resolve(__dirname, '../public', wordFormDataUrl(language).slice(1));
  return JSON.parse(fs.readFileSync(file, 'utf8')) as WordFormData;
}

/** Direct synchronous search tests start with the same complete payload a successful data load supplies. */
export function prepareWordForms(languages: readonly WordFormLanguage[]): void {
  beforeAll(async () => {
    await Promise.all(languages.map(language => loadWordFormLexicon(language, async each => readWordFormFixture(each))));
  });
}
