import { Sermon, PlanData } from '@/models/models';
import { hasWrittenPlan, renderPlanFromSermon, writtenSections } from '@/utils/planText';

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

  return hasPlan(sermon) || sermon.sourceNoteIds?.length ? 'plan' : 'structure';
}

/**
 * Checks if a sermon has a complete plan ready for preaching
 * A plan is considered ready for preaching if it has content in all sections
 */
export function isSermonReadyForPreaching(sermon: Sermon | null | undefined): boolean {
  if (!sermon) return false;

  /**
   * ASKED OF WHAT IS WRITTEN, NOT OF THE ASSEMBLED STRING.
   *
   * This used to read `sermon.draft || sermon.plan`, the document that is no longer stored,
   * and answer "nothing written" for every sermon kept in the current shape. Reading the
   * assembled sections instead would swing the other way: assembly prints the structure's
   * headings, so an untouched plan would look complete.
   */
  const written = writtenSections(sermon);

  return written.introduction && written.main && written.conclusion;
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
  if (!hasPlan(sermon) && !sermon.sourceNoteIds?.length) return `/sermons/${sermonId}/structure`;
  return planEditorRoute(sermonId, sermon);
}

/**
 * The plan screen this sermon's plan is kept in.
 *
 * ASKED OF THE RECORDED MODE, NOT OF THE DATA. Both editors write the same `planText`, so
 * nothing in the content distinguishes them — which is why every shortcut used to open the
 * paired AI screen. For a hand-written plan that screen shows one cell per outline POINT and
 * omits the text under sub-points entirely, so the preacher met his own plan looking half
 * empty (BUG-20260816-manual-plan-opens-in-ai-editor).
 *
 * An absent mode keeps the previous destination on purpose: it means "never recorded", not
 * "AI", and every sermon written before the field existed answers that way.
 */
export function planEditorRoute(sermonId: string, sermon: Sermon | null | undefined): string {
  if (sermon?.planMode === 'note' || (!sermon?.planMode && sermon?.sourceNoteIds?.length)) {
    return `/sermons/${sermonId}/plan/manual?source=note`;
  }
  return sermon?.planMode === 'manual'
    ? `/sermons/${sermonId}/plan/manual`
    : `/sermons/${sermonId}/plan`;
}

/**
 * Extracts PlanData from a sermon for export purposes.
 * Returns undefined if no plan or draft is found or if it's empty.
 */
export function getSermonPlanData(sermon: Sermon | null | undefined): PlanData | undefined {
  if (!sermon) return undefined;
  if (!hasPlan(sermon)) return undefined;

  /**
   * BUILT, NOT READ OUT OF STORAGE — the same source `hasPlan` answers from.
   *
   * This used to take `sermon.draft || sermon.plan`, the assembled document that is no
   * longer stored, and hand back `undefined` for every sermon kept in the current shape.
   * The export buttons take that as "no plan": on the card and in the sermon header Word
   * and PDF went grey while the plan page, which builds its own content, offered them —
   * one plan, two answers, and the grey one was on the screen the person starts from.
   */
  const plan = renderPlanFromSermon(sermon);

  return {
    sermonTitle: sermon.title,
    sermonVerse: sermon.verse,
    introduction: plan.introduction,
    main: plan.main,
    conclusion: plan.conclusion
  };
}
