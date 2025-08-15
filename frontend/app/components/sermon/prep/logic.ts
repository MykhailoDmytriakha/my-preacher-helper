import type { Preparation, ExegeticalPlanNode } from '@/models/models';

export type PrepStepId = 'spiritual' | 'textContext' | 'exegeticalPlan' | 'mainIdea';

// Helper function to check if any node in the exegetical plan tree has a valid title
function hasValidTitleInTree(nodes: ExegeticalPlanNode[]): boolean {
  return nodes.some(node => {
    const hasValidTitle = (node.title || '').trim().length > 0;
    const hasValidChildTitle = node.children && hasValidTitleInTree(node.children);
    return hasValidTitle || hasValidChildTitle;
  });
}

export function getActiveStepId(prep: Preparation | undefined | null): PrepStepId {
  const readAndPrayed = Boolean(prep?.spiritual?.readAndPrayedConfirmed);
  if (!readAndPrayed) return 'spiritual';
  
  const readWholeBook = Boolean(prep?.textContext?.readWholeBookOnceConfirmed);
  const hasContextNotes = ((prep?.textContext?.contextNotes || '').trim().length > 0);
  const hasRepeatedWords = Boolean(prep?.textContext?.repeatedWords && prep.textContext.repeatedWords.length > 0);
  const isTextContextDone = readWholeBook && hasContextNotes && hasRepeatedWords;
  if (!isTextContextDone) return 'textContext';
  
  // Check if exegetical plan is complete
  const exegeticalPlan = prep?.exegeticalPlan;
  const hasExegeticalPlan = Boolean(exegeticalPlan && exegeticalPlan.length > 0);
  const hasExegeticalPlanWithTitles = hasExegeticalPlan && exegeticalPlan && hasValidTitleInTree(exegeticalPlan);
  const hasAuthorIntent = Boolean(prep?.authorIntent && prep.authorIntent.trim().length > 0);
  const isExegeticalPlanDone = hasExegeticalPlanWithTitles && hasAuthorIntent;
  
  if (!isExegeticalPlanDone) return 'exegeticalPlan';
  
  return 'mainIdea';
}


