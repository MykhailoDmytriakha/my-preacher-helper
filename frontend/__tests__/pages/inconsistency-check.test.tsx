import { Sermon } from '@/models/models';
import { getCanonicalTagForSection, normalizeStructureTag } from '@/utils/tagUtils';
import type { StructureSectionId } from '@/utils/tagUtils';

// Изолированная функция для тестирования
const checkForInconsistentThoughts = (sermon: Sermon): boolean => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return false;

  // Проверяем каждую мысль
  return sermon.thoughts.some(thought => {
    // 1. Legacy collision: more than one structure tag on one thought
    const usedStructureTags = thought.tags
      .map((tag) => normalizeStructureTag(tag))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    if (usedStructureTags.length > 1) {
      return true;
    }

    // New thoughts normally have outlinePointId without a structure tag.
    if (usedStructureTags.length === 0) {
      return false;
    }
    
    // 2. Legacy mismatch: a structure tag exists but placement does not match it.
    if (!thought.outlinePointId) return true;
    
    // Определяем секцию пункта плана
    let outlinePointSection: StructureSectionId | undefined;
    
    if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'introduction';
    } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'main';
    } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'conclusion';
    }
    
    if (!outlinePointSection) return true;
    
    return usedStructureTags[0] !== getCanonicalTagForSection(outlinePointSection);
  });
};

describe('Inconsistency Check Function', () => {
  // Базовый каркас проповеди для тестов
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
