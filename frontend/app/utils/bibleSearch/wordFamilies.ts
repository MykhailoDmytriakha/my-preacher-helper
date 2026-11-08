import { formsOfLexeme, lexicalIdsOf, lexemeIdOf } from './wordFormLexicon';
import { matcherOf, type SearchLanguage, type WordMatcher } from './wordForms';
import data from './wordFormsData/families.json';

type FamilyIndex = ReadonlyMap<number, readonly number[]>;

const indexes = new Map<SearchLanguage, FamilyIndex>();

function indexOf(language: SearchLanguage): FamilyIndex {
  const existing = indexes.get(language);
  if (existing) return existing;
  const result = new Map<number, number[]>();
  const add = (from: number, to: number) => {
    const neighbors = result.get(from);
    if (neighbors) neighbors.push(to);
    else result.set(from, [to]);
  };
  for (const [a, b] of data[language].edges) {
    add(a, b);
    add(b, a);
  }
  indexes.set(language, result);
  return result;
}

type EnglishIndex = {
  byLemma: ReadonlyMap<string, number>;
  byForm: ReadonlyMap<string, readonly number[]>;
};
let english: EnglishIndex | undefined;

function englishIndex(): EnglishIndex {
  if (english) return english;
  const byLemma = new Map<string, number>();
  const byForm = new Map<string, number[]>();
  data.en.lexemes.forEach((lemma, id) => {
    byLemma.set(lemma, id);
    const key = matcherOf(lemma, 'en').key;
    const ids = byForm.get(key);
    if (ids) ids.push(id);
    else byForm.set(key, [id]);
  });
  english = { byLemma, byForm };
  return english;
}

function matchingIds(own: WordMatcher, language: SearchLanguage, index: FamilyIndex): readonly number[] {
  if (language === 'en') {
    const { byLemma, byForm } = englishIndex();
    const exact = byLemma.get(own.term);
    return exact === undefined ? (byForm.get(own.key) ?? []) : [exact];
  }
  const exact = lexemeIdOf(own.lemma ?? own.term, language);
  if (exact !== undefined && (own.lemma || index.has(exact))) return [exact];
  return lexicalIdsOf(own.term, language).filter(id => index.has(id));
}

/** A relation belongs to a lexical reading. Common letters and unrelated senses do not establish it. */
export function familyMatcher(own: WordMatcher, language: SearchLanguage): WordMatcher | null {
  if (own.pattern) return null;
  const index = indexOf(language);
  const readings = matchingIds(own, language, index);
  if (!readings.length) return null;
  const related = (index.get(readings[0]) ?? []).filter(id => readings.every(reading => index.get(reading)?.includes(id)));
  if (!related.length) return null;
  const key = `family:${language}:${readings.join('|')}`;
  const relatedIds = new Set(related);
  if (language === 'en') {
    const { byLemma } = englishIndex();
    const forms = related.map(id => matcherOf(data.en.lexemes[id], language));
    return { ...own, key, testSurface: undefined, test: word => {
      const exact = byLemma.get(word);
      return exact === undefined ? forms.some(matcher => matcher.test(word)) : relatedIds.has(exact);
    } };
  }
  const words = new Set(related.flatMap(id => formsOfLexeme(id, language)).filter(word => {
    const exact = lexemeIdOf(word, language);
    return exact === undefined || relatedIds.has(exact);
  }));
  return words.size ? { ...own, key, testSurface: undefined, test: word => words.has(word) } : null;
}
