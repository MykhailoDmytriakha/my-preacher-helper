import data from './wordFormsData/shortNouns.json';

import type { WordFormLanguage } from './wordFormAssets';

type FormGroup = { key: string; lemma: string; forms: ReadonlySet<string>; excluded: ReadonlySet<string> };

function groupByForm(language: WordFormLanguage): ReadonlyMap<string, FormGroup> {
  const groups = new Map<string, FormGroup>();
  for (const [lemma, { forms, aliases, excluded }] of Object.entries(data[language])) {
    const group = { key: `noun:${language}:${lemma}`, lemma, forms: new Set(forms), excluded: new Set(excluded) };
    for (const form of [...forms, ...aliases]) groups.set(form, group);
  }
  return groups;
}

const byForm = { ru: groupByForm('ru'), uk: groupByForm('uk') };

export const shortNounFormsOf = (term: string, language: WordFormLanguage): FormGroup | undefined =>
  byForm[language].get(term);
