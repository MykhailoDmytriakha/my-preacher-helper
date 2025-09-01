import type { Preparation, ExegeticalPlanNode } from '@/models/models';

export type PrepStepId = 'spiritual' | 'textContext' | 'exegeticalPlan' | 'mainIdea' | 'goals' | 'thesis';

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
  
  // Main idea completeness
  const isMainIdeaDone = Boolean(
    prep?.mainIdea?.contextIdea && prep.mainIdea.contextIdea.trim().length > 0 &&
    prep?.mainIdea?.textIdea && prep.mainIdea.textIdea.trim().length > 0 &&
    prep?.mainIdea?.argumentation && prep.mainIdea.argumentation.trim().length > 0
  );
  if (!isMainIdeaDone) return 'mainIdea';

  // Goals completeness: require Timeless Truth and Goal statement
  const hasTimelessTruth = Boolean(prep?.timelessTruth && prep.timelessTruth.trim().length > 0);
  const hasGoalStatement = Boolean(prep?.preachingGoal?.statement && prep.preachingGoal.statement.trim().length > 0);

  if (!(hasTimelessTruth && hasGoalStatement)) return 'goals';

  // Thesis completeness: require exegetical + homiletical + oneSentence
  const ex = (prep?.thesis?.exegetical || '').trim().length > 0;
  const ho = (prep?.thesis?.homiletical || '').trim().length > 0;
  const os = (prep?.thesis?.oneSentence || '').trim().length > 0;
  if (!(ex && ho && os)) return 'thesis';

  return 'thesis';
}
