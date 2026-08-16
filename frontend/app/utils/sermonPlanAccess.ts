import { Sermon, PlanData } from '@/models/models';
import { hasWrittenPlan } from '@/utils/planText';

const hasStructure = (sermon: Sermon | null | undefined): boolean => {
  if (!sermon) return false;
  const structure = sermon.thoughtsBySection || sermon.structure;
  if (!structure) {
    return false;
  }

  const { introduction, main, conclusion } = structure;
  return Boolean(
    introduction?.length ||
    main?.length ||
    conclusion?.length
  );
};

/**
 * Does this sermon have a plan written?
 *
 * Asked of the TEXT, not of a stored assembled string. `hasWrittenPlan` reads whichever
 * shape the sermon is in and only counts text that still belongs to a live node — so a
 * sermon whose points were all deleted, leaving cells behind, correctly answers "no"
 * instead of routing someone to an empty screen.
 *
 * Reading the old assembled string here would have been the quiet failure of this whole
 * change: every sermon saved in the new shape would look plan-less, and the buttons and
 * the router would send people to the structure page instead.
 */
export const hasPlan = (sermon: Sermon | null | undefined): boolean => hasWrittenPlan(sermon);

/**
 * Determines if a sermon is ready for plan access
 * A sermon is considered "prepared" if it has structure or plan
 */
export function isSermonReadyForPlan(sermon: Sermon | null | undefined): boolean {
  if (!sermon) return false;
  return hasStructure(sermon) || hasPlan(sermon);
}

/**
 * Gets the access type for a sermon (plan or structure)
 * Returns the specific type of access available
 * Defaults to 'structure' for new sermons without data
 *
 * UNSORTED THOUGHTS NO LONGER SEND ANYONE ELSEWHERE. This used to also require every
 * thought to sit on an outline point, which is the same rule that once barred the plan
 * screen itself — one loose thought and the shortcut quietly pointed at structure while
 * a finished plan sat one route away. The plan screen now says what is unsorted, in
 * words, on the page where it matters; repeating that judgement here only hid the plan.
 */
export function getSermonAccessType(sermon: Sermon | null | undefined): 'plan' | 'structure' {
  if (!sermon) return 'structure';

  return hasPlan(sermon) ? 'plan' : 'structure';
}

/**
 * Checks if a sermon has a complete plan ready for preaching
 * A plan is considered ready for preaching if it has content in all sections
 */
export function isSermonReadyForPreaching(sermon: Sermon | null | undefined): boolean {
  if (!sermon) return false;
  const draft = sermon.draft || sermon.plan;
  if (!draft) {
    return false;
  }

  const { introduction, main, conclusion } = draft;

  // Check if all sections have meaningful content (not just empty strings)
  const hasIntroContent = Boolean(introduction?.outline?.trim().length);
  const hasMainContent = Boolean(main?.outline?.trim().length);
  const hasConclusionContent = Boolean(conclusion?.outline?.trim().length);

  return hasIntroContent && hasMainContent && hasConclusionContent;
}

/**
 * Gets the preferred plan access route for a sermon
 * Prioritizes plan over structure when a plan exists
 * Defaults to structure page for new sermons
 *
 * Same reason as `getSermonAccessType`: unsorted thoughts are reported on the plan
 * screen, not used to route people away from it.
 */
export function getSermonPlanAccessRoute(sermonId: string, sermon: Sermon): string {
  return hasPlan(sermon)
    ? `/sermons/${sermonId}/plan`
    : `/sermons/${sermonId}/structure`;
}

/**
 * Extracts PlanData from a sermon for export purposes.
 * Returns undefined if no plan or draft is found or if it's empty.
 */
export function getSermonPlanData(sermon: Sermon | null | undefined): PlanData | undefined {
  if (!sermon) return undefined;
  const planSource = sermon.draft || sermon.plan;
  if (!planSource) return undefined;

  // A plan is considered ready if at least one section has an outline
  if (!hasPlan(sermon)) return undefined;

  return {
    sermonTitle: sermon.title,
    sermonVerse: sermon.verse,
    introduction: planSource.introduction?.outline || '',
    main: planSource.main?.outline || '',
    conclusion: planSource.conclusion?.outline || ''
  };
}
