import { analysisMarkdown, analysisState, passageWords, storedAnalysis, type AnalysisState, type Relation } from '@/utils/passageAnalysis';
import { studyAnalysisPositionBasis } from '@/utils/studyAnalysisSource';

import { equalValues, mergeFields } from './protocol';

import type { DocumentData } from './types';
import type { StudyAnalysis } from '@/models/models';
import type { BibleId } from '@/utils/bibles';
import type { BookText } from '@/utils/bibleText';

export type StudyAnalysisCreationPlan = { kind: 'ready'; value: DocumentData } | { kind: 'review'; reason: string };
type AnalysisRecord = Record<string, unknown>;

const object = (value: unknown): value is AnalysisRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const review = (reason: string): StudyAnalysisCreationPlan => ({ kind: 'review', reason });

/** Marks a note as an initial analysis created by this generated-transfer flow. */
export function analysisCreationScope(id: string): string {
  return `analysis-creation:${id}`;
}

function stableLocalFields(value: DocumentData): DocumentData {
  return Object.fromEntries(Object.entries(value).filter(([field]) => !['analysis', 'content', 'updatedAt'].includes(field)));
}

function readCanonicalState(value: DocumentData, bible: BibleId, words: ReturnType<typeof passageWords>): AnalysisState | null {
  if (value.type !== 'analysis' || typeof value.content !== 'string' || !object(value.analysis)) return null;
  const raw = value.analysis;
  const allowed = new Set(['bible', 'words', 'cuts', 'links', 'relations']);
  if (Object.keys(raw).some(key => !allowed.has(key))
    || !['bible', 'words', 'cuts', 'links'].every(key => Object.prototype.hasOwnProperty.call(raw, key))
    || raw.bible !== bible || raw.words !== words.length || !Array.isArray(raw.cuts) || !object(raw.links)
    || (raw.relations !== undefined && !object(raw.relations))) return null;
  if (!raw.cuts.every(cut => typeof cut === 'number' && Number.isSafeInteger(cut))
    || Object.entries(raw.links).some(([key, word]) => !Number.isSafeInteger(Number(key)) || String(Number(key)) !== key
      || typeof word !== 'number' || !Number.isSafeInteger(word))) return null;
  try {
    const state = analysisState(raw as unknown as StudyAnalysis, words.length);
    const canonical = storedAnalysis(state, bible, words.length) as unknown as DocumentData;
    // `relations` was added after the original stored format; only its absence is accepted as empty.
    const normalized = { ...raw, relations: raw.relations ?? {} } as DocumentData;
    if (!equalValues(normalized, canonical) || value.content !== analysisMarkdown(words, state)) return null;
    return state;
  } catch {
    return null;
  }
}

function mergeMap(local: DocumentData, target: DocumentData, path: string): DocumentData | null {
  const merged = mergeFields({ exists: true, value: {} }, { exists: true, value: local }, { exists: true, value: target }, [path]);
  return merged.conflicts.length === 0 && merged.value.exists && object(merged.value.value)
    ? merged.value.value as DocumentData : null;
}

function relationMap(state: AnalysisState): DocumentData {
  return Object.fromEntries(state.relations.map(relation => [
    `${relation.a}-${relation.b}`, JSON.stringify([relation.dir, relation.color]),
  ]));
}

function decodeRelations(value: DocumentData): Relation[] | null {
  try {
    return Object.entries(value).map(([key, encoded]) => {
      if (typeof encoded !== 'string') throw new Error('Invalid encoded relation');
      const [a, b] = key.split('-').map(Number);
      const pair = JSON.parse(encoded) as unknown;
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isSafeInteger(a) || !Number.isSafeInteger(b)
        || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') throw new Error('Invalid encoded relation');
      return { a, b, dir: pair[0] as Relation['dir'], color: pair[1] as Relation['color'] };
    });
  } catch {
    return null;
  }
}

/** Merge only validated positional marks for three generated copies of one known analysis passage. */
export function planStudyAnalysisCreation(initial: DocumentData, local: DocumentData, target: DocumentData,
  text: BookText): StudyAnalysisCreationPlan {
  const bases = [initial, local, target].map(value => studyAnalysisPositionBasis(value));
  const [basis] = bases;
  if (!basis || bases.some(candidate => !candidate || !equalValues(candidate, basis))) {
    return review('The captured analyses do not describe the same known passage.');
  }
  if (basis.book !== text.id) return review('The loaded Bible text does not match the captured book.');
  const words = passageWords(text, { chapter: basis.chapter, fromVerse: basis.fromVerse, toChapter: basis.toChapter, toVerse: basis.toVerse });
  if (words.length !== basis.words) return review('The loaded passage word count changed.');

  const initialState = readCanonicalState(initial, basis.bible, words);
  const localState = readCanonicalState(local, basis.bible, words);
  const targetState = readCanonicalState(target, basis.bible, words);
  if (!initialState || !localState || !targetState) return review('An analysis contains marks or text that cannot be safely interpreted.');
  if (!equalValues(stableLocalFields(initial), stableLocalFields(local))) {
    return review('The local analysis has later authored fields that need review.');
  }

  // A generated creation is an empty mark intent; the first captured mark is content,
  // not a merge baseline. Model each mark map through the shared three-way merge.
  const localStored = storedAnalysis(localState, basis.bible, words.length);
  const targetStored = storedAnalysis(targetState, basis.bible, words.length);
  const cuts = mergeMap(Object.fromEntries(localState.cuts.map(cut => [String(cut), true])),
    Object.fromEntries(targetState.cuts.map(cut => [String(cut), true])), 'cuts');
  const links = mergeMap(localStored.links as DocumentData, targetStored.links as DocumentData, 'links');
  const relations = mergeMap(relationMap(localState), relationMap(targetState), 'relations');
  if (!cuts || !links || !relations) return review('The local and existing marks disagree at the same position.');

  const mergedRelations = decodeRelations(relations);
  if (!mergedRelations) return review('A merged relation cannot be interpreted.');
  const mergedState: AnalysisState = {
    cuts: Object.keys(cuts).map(Number).sort((a, b) => a - b),
    links: Object.fromEntries(Object.entries(links).map(([key, word]) => [Number(key), word as number])),
    relations: mergedRelations,
  };
  const mergedStored = storedAnalysis(mergedState, basis.bible, words.length);
  const settled = analysisState(mergedStored, words.length);
  if (!equalValues(storedAnalysis(settled, basis.bible, words.length), mergedStored)) {
    return review('The combined marks would create a cycle or lose a positional link.');
  }

  return { kind: 'ready', value: { ...target, analysis: mergedStored as unknown as DocumentData['analysis'],
    content: analysisMarkdown(words, settled) } };
}
