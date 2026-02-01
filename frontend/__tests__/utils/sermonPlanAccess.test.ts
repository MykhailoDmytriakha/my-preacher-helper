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

  it('falls back to structure access when thoughts are not assigned', () => {
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

    expect(getSermonAccessType(sermon)).toBe('structure');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/structure`);
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
    expect(getSermonAccessType(sermon)).toBe('structure');
    expect(getSermonPlanAccessRoute(sermon.id, sermon)).toBe(`/sermons/${sermon.id}/structure`);
  });
});
