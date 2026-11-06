import { isWordFormData, type WordFormData as LexiconData, type WordFormLanguage as Language } from './wordFormAssets';
import { fetchWordFormData } from './wordFormData';

const LOOKUPS_KEPT = 128;

/** Verified complete word forms, stored as shared suffix sets rather than repeated full words. */
class WordFormLexicon {
  private readonly suffixes: string[][];
  private readonly suffixSets: Set<string>[];
  private readonly byStem = new Map<string, number[]>();
  private readonly stemLengths: number[];
  private readonly lookups = new Map<string, readonly number[]>();
  private readonly maxWordLength: number;

  constructor(private readonly data: LexiconData) {
    this.suffixes = data.paradigms.map((line) => line.split(' '));
    this.suffixSets = this.suffixes.map((values) => new Set(values));
    const longestSuffix = this.suffixes.map((values) => values.reduce((length, value) => Math.max(length, value.length), 0));
    const lengths = new Set<number>();
    let longest = 0;
    data.entries.forEach(([, stem, paradigm], id) => {
      const entries = this.byStem.get(stem);
      if (entries) entries.push(id);
      else this.byStem.set(stem, [id]);
      lengths.add(stem.length);
      longest = Math.max(longest, stem.length + longestSuffix[paradigm]);
    });
    this.stemLengths = Array.from(lengths).sort((left, right) => left - right);
    this.maxWordLength = longest;
  }

  identities(word: string): readonly number[] {
    // A pasted long line must not cause quadratic prefix work or enter the lookup cache.
    if (word.length > this.maxWordLength) return [];
    const kept = this.lookups.get(word);
    if (kept) return kept;
    const identities: number[] = [];
    for (const length of this.stemLengths) {
      if (length > word.length) break;
      const entries = this.byStem.get(word.slice(0, length));
      if (!entries) continue;
      const ending = word.slice(length);
      for (const id of entries) {
        if (this.suffixSets[this.data.entries[id][2]].has(ending)) identities.push(id);
      }
    }
    identities.sort((left, right) => left - right);
    this.lookups.set(word, identities);
    if (this.lookups.size > LOOKUPS_KEPT) this.lookups.delete(this.lookups.keys().next().value as string);
    return identities;
  }

  hasLemma(word: string, accepts: (lemma: string) => boolean): boolean {
    return this.identities(word).some((id) => accepts(this.data.entries[id][0]));
  }

  forms(word: string): { key: string; words: ReadonlySet<string> } | null {
    const identities = this.identities(word);
    if (!identities.length) return null;
    const words = new Set<string>();
    for (const id of identities) {
      const [, stem, paradigm] = this.data.entries[id];
      for (const ending of this.suffixes[paradigm]) words.add(stem + ending);
    }
    return { key: `l:${this.data.language}:${identities.join('|')}`, words };
  }
}

const loaded: Partial<Record<Language, WordFormLexicon>> = {};
const loading: Partial<Record<Language, Promise<void>>> = {};

export const wordFormLexiconReady = (language: Language): boolean => Boolean(loaded[language]);

/** One request per language; a refused load leaves no poisoned promise and can be retried. */
export function loadWordFormLexicon(language: Language,
  readData: (language: Language) => Promise<LexiconData> = fetchWordFormData): Promise<void> {
  if (loaded[language]) return Promise.resolve();
  if (loading[language]) return loading[language];
  const run = Promise.resolve().then(() => readData(language)).then(data => {
    if (!isWordFormData(data, language)) throw new Error(`Word forms for ${language}: invalid language payload`);
    loaded[language] = new WordFormLexicon(data);
  });
  loading[language] = run.finally(() => { delete loading[language]; });
  return loading[language];
}

const lexicon = (language: Language): WordFormLexicon => {
  const current = loaded[language];
  if (!current) throw new Error(`Word forms for ${language} are not ready`);
  return current;
};

/** Tests reset only settled lexical state; application callers retain it for the page's life. */
export function resetWordFormLexiconsForTests(): void {
  delete loaded.ru; delete loaded.uk;
  delete loading.ru; delete loading.uk;
}

/** A query's verified readings. This validates candidate spellings; it does not add search candidates. */
export const lexicalFormsOf = (word: string, language: Language): { key: string; words: ReadonlySet<string> } | null => lexicon(language).forms(word);

/** Unknown names may keep regular endings, but must not claim a known word of another identity. */
export const isLexicalWord = (word: string, language: Language): boolean => lexicon(language).identities(word).length > 0;

/** A separate kin rule may inspect the real lemma of a spelling without guessing a new form. */
export const hasLexicalLemma = (word: string, language: Language, accepts: (lemma: string) => boolean): boolean => lexicon(language).hasLemma(word, accepts);
