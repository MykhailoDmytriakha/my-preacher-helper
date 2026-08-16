import {
  isSermonReadyForPlan,
  getSermonAccessType,
  getSermonPlanAccessRoute,
  getSermonPlanData,
  hasPlan,
  isSermonReadyForPreaching,
} from '@/utils/sermonPlanAccess';

import type { Sermon } from '@/models/models';

describe('sermonPlanAccess utilities', () => {
  const baseSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2024-01-01',
    thoughts: [],
    userId: 'user-1',
  };

  it('detects readiness when only structure is present', () => {
    const sermon: Sermon = {
      ...baseSermon,
      structure: {
        introduction: ['Intro'],
        main: [],
        conclusion: [],
        ambiguous: [],
      },
    };

    expect(isSermonReadyForPlan(sermon)).toBe(true);
    expect(getSermonAccessType(sermon)).toBe('structure');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/structure`);
  });

  it('returns safe defaults for null or undefined inputs', () => {
    expect(hasPlan(null)).toBe(false);
    expect(hasPlan(undefined)).toBe(false);
    expect(isSermonReadyForPlan(null)).toBe(false);
    expect(getSermonAccessType(undefined)).toBe('structure');
    expect(isSermonReadyForPreaching(null)).toBe(false);
    expect(getSermonPlanData(undefined)).toBeUndefined();
  });

  it('prefers plan access when a complete plan exists and thoughts are assigned', () => {
    const sermon: Sermon = {
      ...baseSermon,
      thoughts: [
        { id: 't1', text: 'Thought', date: '2024-01-01', tags: [], outlinePointId: 'p1' },
      ],
      plan: {
        introduction: { outline: 'Intro outline' },
        main: { outline: 'Main outline' },
        conclusion: { outline: 'Conclusion outline' },
      },
    };

    expect(isSermonReadyForPlan(sermon)).toBe(true);
    expect(getSermonAccessType(sermon)).toBe('plan');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/plan`);
  });

  it('still opens the plan when some thoughts are left unassigned', () => {
    // A loose thought used to divert this shortcut to the structure page, hiding a plan
    // that already existed. Unsorted thoughts are now reported ON the plan screen; they
    // are not grounds for routing someone away from it.
    const sermon: Sermon = {
      ...baseSermon,
      thoughts: [
        { id: 't1', text: 'Orphan thought', date: '2024-01-01', tags: [] },
      ],
      plan: {
        introduction: { outline: 'Intro outline' },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
    };

    expect(getSermonAccessType(sermon)).toBe('plan');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/plan`);
  });

  it('opens the plan for a sermon that has a plan and no thoughts at all', () => {
    // Building a plan by hand is a first-class path: no thoughts is not an unfinished
    // state to be corrected, it is how some sermons are prepared.
    const sermon: Sermon = {
      ...baseSermon,
      thoughts: [],
      plan: {
        introduction: { outline: 'Intro outline' },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
    };

    expect(getSermonAccessType(sermon)).toBe('plan');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/plan`);
  });

  it('defaults to structure access when neither plan nor structure exists', () => {
    const sermon = { ...baseSermon };

    expect(isSermonReadyForPlan(sermon)).toBe(false);
    expect(getSermonAccessType(sermon)).toBe('structure');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/structure`);
  });

  it('returns plan data when any outline section is present', () => {
    const sermon: Sermon = {
      ...baseSermon,
      plan: {
        introduction: { outline: 'Intro outline' },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
    };

    const planData = getSermonPlanData(sermon);

    expect(planData).toEqual({
      sermonTitle: baseSermon.title,
      sermonVerse: baseSermon.verse,
      introduction: 'Intro outline',
      main: '',
      conclusion: '',
    });
  });

  it('returns undefined plan data when outlines are empty', () => {
    const sermon: Sermon = {
      ...baseSermon,
      plan: {
        introduction: { outline: '' },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
    };

    expect(hasPlan(sermon)).toBe(false);
    expect(getSermonPlanData(sermon)).toBeUndefined();
  });

  it('prefers draft over plan when extracting plan data', () => {
    const sermon: Sermon = {
      ...baseSermon,
      plan: {
        introduction: { outline: 'Plan intro' },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
      draft: {
        introduction: { outline: 'Draft intro' },
        main: { outline: 'Draft main' },
        conclusion: { outline: 'Draft conclusion' },
      },
    };

    const planData = getSermonPlanData(sermon);

    expect(planData).toEqual({
      sermonTitle: baseSermon.title,
      sermonVerse: baseSermon.verse,
      introduction: 'Draft intro',
      main: 'Draft main',
      conclusion: 'Draft conclusion',
    });
  });

  it('handles partial plan and partial structure inputs consistently', () => {
    const sermon: Sermon = {
      ...baseSermon,
      thoughts: [
        { id: 't1', text: 'Thought 1', date: '2024-01-01', tags: [], outlinePointId: undefined },
        { id: 't2', text: 'Thought 2', date: '2024-01-02', tags: [], outlinePointId: 'main-1' },
      ],
      plan: {
        introduction: { outline: '' },
        main: { outline: 'Main outline' },
        conclusion: { outline: '' },
      },
      structure: {
        introduction: [],
        main: ['Point 1'],
        conclusion: [],
        ambiguous: [],
      },
    };

    expect(isSermonReadyForPlan(sermon)).toBe(true);
    // One thought sorted, one not — the plan exists, so the plan is where this goes.
    expect(getSermonAccessType(sermon)).toBe('plan');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/plan`);
  });
});

/**
 * THE ROUTE MUST OPEN THE EDITOR THE PLAN IS KEPT IN — BUG-20260816-manual-plan-opens-in-ai-editor.
 *
 * The shortcut used to ask only "is there a plan" and always send people to the paired
 * AI screen. For a plan written by hand that is the wrong room, and it is worse than a
 * detour: that screen renders one cell per outline POINT, so the text under sub-points is
 * not shown at all and the preacher sees his own plan as if half of it had gone missing.
 */
describe('getSermonPlanAccessRoute honours the editor the plan is kept in', () => {
  const withPlan = (planMode?: 'manual' | 'ai'): Sermon => ({
    id: 's1',
    title: 'Град Божий',
    verse: '',
    date: '2026-08-16',
    userId: 'u1',
    thoughts: [],
    outline: { introduction: [{ id: 'p1', text: 'Перепись' }], main: [], conclusion: [] },
    planText: { p1: 'написано вручную' },
    ...(planMode ? { planMode } : {}),
  } as unknown as Sermon);

  it('opens the hand-written editor for a plan kept by hand', () => {
    expect(getSermonPlanAccessRoute('s1', withPlan('manual'))).toBe('/sermons/s1/plan/manual');
  });

  it('opens the paired editor for a plan kept there', () => {
    expect(getSermonPlanAccessRoute('s1', withPlan('ai'))).toBe('/sermons/s1/plan');
  });

  /**
   * Nothing recorded the mode before this existed, so every sermon written so far answers
   * "unknown". Sending those to the paired screen keeps the behaviour they already have —
   * changing it would move people's plans out from under them on the day this ships.
   */
  it('keeps the previous behaviour when no mode was ever recorded', () => {
    expect(getSermonPlanAccessRoute('s1', withPlan())).toBe('/sermons/s1/plan');
  });

  it('still sends a sermon without a plan to structure, whatever the mode says', () => {
    const noPlan = { ...withPlan('manual'), planText: {} } as unknown as Sermon;
    expect(getSermonPlanAccessRoute('s1', noPlan)).toBe('/sermons/s1/structure');
  });
});
