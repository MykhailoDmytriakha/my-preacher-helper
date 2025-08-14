import type { Preparation } from '@/models/models';

export type PrepStepId = 'spiritual' | 'textContext' | 'exegeticalPlan' | 'mainIdea';

export function getActiveStepId(prep: Preparation | undefined | null): PrepStepId {
  const readAndPrayed = Boolean(prep?.spiritual?.readAndPrayedConfirmed);
  if (!readAndPrayed) return 'spiritual';
  const readWholeBook = Boolean(prep?.textContext?.readWholeBookOnceConfirmed);
  const hasContextNotes = ((prep?.textContext?.contextNotes || '').trim().length > 0);
  const hasRepeatedWords = Boolean(prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0);
  const isTextContextDone = readWholeBook && hasContextNotes && hasRepeatedWords;
  return isTextContextDone ? 'exegeticalPlan' : 'textContext';
}


