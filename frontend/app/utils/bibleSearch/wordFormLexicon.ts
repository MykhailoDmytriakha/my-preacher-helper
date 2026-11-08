import { isWordFormData, type WordFormData as LexiconData, type WordFormLanguage as Language } from './wordFormAssets';
import { fetchWordFormData } from './wordFormData';

const LOOKUPS_KEPT = 128;

// The Synodal text retains this instrumental spelling in Acts 15:11 and other verses.
const PRINTED_VARIANTS: Readonly<Partial<Record<Language, ReadonlyMap<string, string>>>> = {
  ru: new Map([['благодатию', 'благодатью']]),
};

/** Verified complete word forms, stored as shared suffix sets rather than repeated full words. */
class WordFormLexicon {
  private readonly suffixes: string[][];
  private readonly suffixSets: Set<string>[];
  private readonly byStem = new Map<string, number[]>();
  private readonly byLemma = new Map<string, number>();
  private readonly stemLengths: number[];
  private readonly lookups = new Map<string, readonly number[]>();
  private readonly maxWordLength: number;

  constructor(private readonly data: LexiconData) {
    this.suffixes = data.paradigms.map((line) => line.split(' '));
    this.suffixSets = this.suffixes.map((values) => new Set(values));
    const longestSuffix = this.suffixes.map((values) => values.reduce((length, value) => Math.max(length, value.length), 0));
    const lengths = new Set<number>();
    let longest = 0;
    data.entries.forEach(([lemma, stem, paradigm], id) => {
      this.byLemma.set(lemma, id);
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
    const spelling = PRINTED_VARIANTS[this.data.language]?.get(word) ?? word;
    if (spelling.length > this.maxWordLength) return [];
    const kept = this.lookups.get(spelling);
    if (kept) return kept;
    const identities: number[] = [];
    for (const length of this.stemLengths) {
      if (length > spelling.length) break;
      const entries = this.byStem.get(spelling.slice(0, length));
      if (!entries) continue;
      const ending = spelling.slice(length);
      for (const id of entries) {
        if (this.suffixSets[this.data.entries[id][2]].has(ending)) identities.push(id);
      }
    }
    identities.sort((left, right) => left - right);
    this.lookups.set(spelling, identities);
    if (this.lookups.size > LOOKUPS_KEPT) this.lookups.delete(this.lookups.keys().next().value as string);
    return identities;
  }

  lexemeId(lemma: string): number | undefined {
    return this.byLemma.get(lemma);
  }

  formsOfLexeme(id: number): string[] {
    const entry = this.data.entries[id];
    if (!entry) return [];
    const [, stem, paradigm] = entry;
    const forms = this.suffixes[paradigm].map(ending => stem + ending);
    for (const [printed, standard] of PRINTED_VARIANTS[this.data.language] ?? []) {
      if (forms.includes(standard)) forms.push(printed);
    }
    return forms;
  }

  forms(word: string): { key: string; words: ReadonlySet<string> } | null {
    const identities = this.identities(word);
    if (!identities.length) return null;
    const words = new Set(identities.flatMap(id => this.formsOfLexeme(id)));
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

export const lexicalIdsOf = (word: string, language: Language): readonly number[] => lexicon(language).identities(word);
export const lexemeIdOf = (lemma: string, language: Language): number | undefined => lexicon(language).lexemeId(lemma);
export const formsOfLexeme = (id: number, language: Language): string[] => lexicon(language).formsOfLexeme(id);
