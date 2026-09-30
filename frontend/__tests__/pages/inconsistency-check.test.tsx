import { Sermon } from '@/models/models';
import { sermonHasInconsistentThoughts } from '@/utils/thoughtStructureConsistency';

// The real check the sermon page runs (BUG-20260929-tests-check-their-own-copy: this file used to
// hold a copy of it, so breaking the page's check left these tests green).
const checkForInconsistentThoughts = (sermon: Sermon): boolean => sermonHasInconsistentThoughts(sermon);

describe('Inconsistency Check Function', () => {
  // A base sermon for the tests
  const baseSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'Test Verse',
    userId: 'user-1',
    date: '2023-01-01',
    thoughts: [],
    outline: {
      introduction: [{ id: 'intro-1', text: 'Introduction point 1' }],
      main: [{ id: 'main-1', text: 'Main point 1' }],
      conclusion: [{ id: 'concl-1', text: 'Conclusion point 1' }]
    }
  };

  it('returns false when sermon has no thoughts', () => {
    const sermon = { ...baseSermon, thoughts: [] };
    expect(checkForInconsistentThoughts(sermon)).toBe(false);
  });

  it('returns false when sermon has no outline', () => {
    const sermon = { ...baseSermon, outline: undefined };
    expect(checkForInconsistentThoughts(sermon)).toBe(false);
  });

  it('returns false when legacy structure tags match assignments', () => {
    const sermon = { 
      ...baseSermon, 
      thoughts: [
        {
          id: 'thought-1',
          text: 'Introduction thought',
          tags: ['Вступление'],
          date: '2023-01-01',
          outlinePointId: 'intro-1'
        },
        {
          id: 'thought-2',
          text: 'Main part thought',
          tags: ['Основная часть'],
          date: '2023-01-01',
          outlinePointId: 'main-1'
        },
        {
          id: 'thought-3',
          text: 'Conclusion thought',
          tags: ['Заключение'],
          date: '2023-01-01',
          outlinePointId: 'concl-1'
        }
      ]
    };
    
    expect(checkForInconsistentThoughts(sermon)).toBe(false);
  });

  it('returns false when new thoughts have outlinePointId without structure tags', () => {
    const sermon = {
      ...baseSermon,
      thoughts: [
        {
          id: 'thought-1',
          text: 'New outline-linked thought',
          tags: ['application'],
          date: '2023-01-01',
          outlinePointId: 'main-1'
        }
      ]
    };

    expect(checkForInconsistentThoughts(sermon)).toBe(false);
  });

  it('returns true when a thought has tag inconsistent with outline point', () => {
    const sermon = { 
      ...baseSermon, 
      thoughts: [
        {
          id: 'thought-1',
          text: 'Mismatched thought',
          tags: ['Вступление'], // Introduction tag
          date: '2023-01-01',
          outlinePointId: 'main-1' // But assigned to main point
        }
      ]
    };
    
    expect(checkForInconsistentThoughts(sermon)).toBe(true);
  });

  it('returns true when a legacy structure tag has no outline point assignment', () => {
    const sermon = {
      ...baseSermon,
      thoughts: [
        {
          id: 'thought-1',
          text: 'Tagged but unassigned thought',
          tags: ['Вступление'],
          date: '2023-01-01'
        }
      ]
    };

    expect(checkForInconsistentThoughts(sermon)).toBe(true);
  });

  it('returns true when a thought has multiple structure tags', () => {
    const sermon = { 
      ...baseSermon, 
      thoughts: [
        {
          id: 'thought-1',
          text: 'Multiple tags thought',
          tags: ['Вступление', 'Основная часть'], // Both intro and main tags
          date: '2023-01-01'
        }
      ]
    };
    
    expect(checkForInconsistentThoughts(sermon)).toBe(true);
  });

  it('returns true when one thought is inconsistent among many consistent ones', () => {
    const sermon = { 
      ...baseSermon, 
      thoughts: [
        {
          id: 'thought-1',
          text: 'Introduction thought',
          tags: ['Вступление'],
          date: '2023-01-01',
          outlinePointId: 'intro-1'
        },
        {
          id: 'thought-2',
          text: 'Main part thought',
          tags: ['Основная часть'],
          date: '2023-01-01',
          outlinePointId: 'main-1'
        },
        {
          id: 'thought-3',
          text: 'Inconsistent thought',
          tags: ['Заключение'], // Conclusion tag
          date: '2023-01-01',
          outlinePointId: 'intro-1' // But assigned to intro point
        }
      ]
    };
    
    expect(checkForInconsistentThoughts(sermon)).toBe(true);
  });
}); 
