import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sources from '@/utils/bibleSearch/wordFormsData/sources.json';

const root = path.resolve(__dirname, '../../../..');
const sha = (relative: string) => createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');

describe('the generated lexical data follows the current Bible text and normalizer', () => {
  it('was generated with the current application text functions', () => {
    expect(sha('frontend/app/utils/bibleSearch/words.ts')).toBe(sources.corpus.sourceHashes.wordsTs);
    expect(sha('frontend/app/utils/bibleBooks.ts')).toBe(sources.corpus.sourceHashes.bibleBooksTs);
    expect(sha('frontend/app/utils/bibleText.ts')).toBe(sources.corpus.sourceHashes.bibleTextTs);
  });

  it.each(['rst', 'ubio'] as const)('covers every current %s book and its exact bytes', (bible) => {
    const directory = `frontend/public/bible-text/${bible}/v1`;
    const files = fs.readdirSync(path.join(root, directory)).filter((file) => file.endsWith('.json')).map((file) => `${directory}/${file}`).sort();
    const recorded = sources.corpus.corpus[bible];
    expect(recorded.map((book) => book.path).sort()).toEqual(files);
    for (const book of recorded) expect(sha(book.path)).toBe(book.sha256);
  });

  it.each(['ru', 'uk'] as const)('retains the recorded %s payload and format', (language) => {
    const relative = `frontend/app/utils/bibleSearch/wordFormsData/${language}.json`;
    expect(sha(relative)).toBe(sources[language].sha256);
    const data = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8')) as { schema: number; language: string };
    expect(data.schema).toBe(1);
    expect(data.language).toBe(language);
  });
});
