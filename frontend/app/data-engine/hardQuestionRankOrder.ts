import { hardQuestionGroupById } from './hardQuestionGroupCreation';

import type { DocumentData } from './types';

export const HARD_QUESTION_REORDER = 'hard-question-reorder';
export type HardQuestionRankCollection = 'hardQuestions' | 'hardQuestionThemes';
export type HardQuestionRankScope = { themeId: string | null; groupId: string | null };
export type HardQuestionRankOpening = HardQuestionRankScope & { rank: number | null };
export type HardQuestionRankWitness = { id: string; opening: HardQuestionRankOpening };
export type HardQuestionRankChange = HardQuestionRankWitness & { rank: number };
export type HardQuestionRankWitnessProof = HardQuestionRankWitness & { generation: string | null };
export type CapturedHardQuestionRankWitness = HardQuestionRankWitnessProof & {
  predecessor?: string;
};

export function hardQuestionRankCollection(collection: string): collection is HardQuestionRankCollection {
  return collection === 'hardQuestions' || collection === 'hardQuestionThemes';
}

export function hardQuestionRankOpening(value: { rank?: unknown; themeId?: unknown; groupId?: unknown }): HardQuestionRankOpening {
  return {
    rank: typeof value.rank === 'number' && Number.isFinite(value.rank) ? value.rank : null,
    themeId: typeof value.themeId === 'string' && value.themeId ? value.themeId : null,
    groupId: typeof value.groupId === 'string' && value.groupId ? value.groupId : null,
  };
}

export function hardQuestionEffectiveRankScope(opening: HardQuestionRankOpening, theme: DocumentData | null | undefined): HardQuestionRankScope {
  if (!theme) return { themeId: null, groupId: null };
  const group = opening.groupId ? hardQuestionGroupById(theme, opening.groupId) : undefined;
  return { themeId: opening.themeId, groupId: group?.id ?? null };
}
