import {
  isSermonReadyForPlan,
  getSermonAccessType,
  getSermonPlanAccessRoute,
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
