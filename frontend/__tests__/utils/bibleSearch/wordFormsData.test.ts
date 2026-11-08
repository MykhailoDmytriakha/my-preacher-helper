import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sources from '@/utils/bibleSearch/wordFormsData/sources.json';
import assets from '@/utils/bibleSearch/wordFormsData/assets.json';
import shortNouns from '@/utils/bibleSearch/wordFormsData/shortNouns.json';
import families from '@/utils/bibleSearch/wordFormsData/families.json';
import familySources from '@/utils/bibleSearch/wordFormsData/familySources.json';

const root = path.resolve(__dirname, '../../../..');
const sha = (relative: string) => createHash('sha256').update(fs.readFileSync(path.join(root, relative))).digest('hex');

describe('the generated lexical data follows the current Bible text and normalizer', () => {
  it('uses the supported content-addressed asset manifest shape', () => {
    expect(assets.schema).toBe(1);
    expect(Object.keys(assets.languages).sort()).toEqual(['ru', 'uk']);
  });

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

  it('retains the recorded short noun groups with each spelling owned by one lemma', () => {
    const relative = 'frontend/app/utils/bibleSearch/wordFormsData/shortNouns.json';
    expect(sha(relative)).toBe(sources.shortNouns.sha256);
    for (const language of ['ru', 'uk'] as const) {
      const groups = Object.values(shortNouns[language]);
      expect(groups).toHaveLength(sources.shortNouns.entries[language]);
      const forms = groups.flatMap(group => [...group.forms, ...group.aliases]);
      expect(new Set(forms).size).toBe(forms.length);
    }
  });

  it.each(['ru', 'uk'] as const)('retains the recorded %s payload and format', (language) => {
    const asset = assets.languages[language];
    const relative = `frontend/public/bible-word-forms/${asset.file}`;
    const bytes = fs.readFileSync(path.join(root, relative));
    expect(asset.file).toBe(`${language}-${sources[language].sha256}.json`);
    expect(sha(relative)).toBe(sources[language].sha256);
    expect(asset.sha256).toBe(sources[language].sha256);
    expect(bytes.byteLength).toBe(sources[language].bytes);
    expect(asset.bytes).toBe(sources[language].bytes);
    const data = JSON.parse(bytes.toString('utf8')) as { schema: number; language: string; entries: unknown[]; paradigms: unknown[] };
    expect(data.schema).toBe(1);
    expect(data.language).toBe(language);
    expect(asset.entries).toBe(data.entries.length);
    expect(asset.paradigms).toBe(data.paradigms.length);
  });
});


describe('the generated word-family index follows its lexemes and Bible editions', () => {
  it('matches its recorded data, tokenizers, and King James corpus', () => {
    expect(families.schema).toBe(1);
    expect(sha('frontend/app/utils/bibleSearch/wordFormsData/families.json')).toBe(familySources.sha256);
    for (const [file, hash] of Object.entries(familySources.tokenizers)) {
      expect(sha(`frontend/${file}`)).toBe(hash);
    }
    const directory = 'frontend/public/bible-text/kjv/v1';
    const files = fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.json')).sort();
    expect(Object.keys(familySources.kjvBooks).sort()).toEqual(files);
    for (const [file, hash] of Object.entries(familySources.kjvBooks)) {
      expect(sha(`${directory}/${file}`)).toBe(hash);
    }
  });

  it('binds every undirected edge to one valid pair of lexemes', () => {
    for (const language of ['ru', 'uk'] as const) {
      expect(families[language].wordFormsSha256).toBe(assets.languages[language].sha256);
    }
    for (const language of ['ru', 'uk', 'en'] as const) {
      const edges = families[language].edges;
      const count = language === 'en' ? families.en.lexemes.length : assets.languages[language].entries;
      expect(edges).toHaveLength(familySources.languages[language].edgeCount);
      expect(edges.every(([from, to]) =>
        Number.isInteger(from) && Number.isInteger(to) && from >= 0 && from < to && to < count)).toBe(true);
      expect(new Set(edges.map(([from, to]) => `${from}:${to}`)).size).toBe(edges.length);
    }
    expect(new Set(families.en.lexemes).size).toBe(families.en.lexemes.length);
  });
});
