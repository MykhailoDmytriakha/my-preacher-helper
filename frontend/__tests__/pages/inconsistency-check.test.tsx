import { Sermon } from '@/models/models';
import { getCanonicalTagForSection, normalizeStructureTag } from '@/utils/tagUtils';

// Изолированная функция для тестирования
const checkForInconsistentThoughts = (sermon: Sermon): boolean => {
  if (!sermon || !sermon.thoughts || !sermon.outline) return false;
  
  // Проверяем каждую мысль
  return sermon.thoughts.some(thought => {
    // 1. Проверка на несколько обязательных тегов у одной мысли
    const usedRequiredTags = thought.tags
      .map((tag) => normalizeStructureTag(tag))
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
    if (usedRequiredTags.length > 1) {
      return true; // Несогласованность: несколько обязательных тегов
    }
    
    // 2. Проверка на несогласованность между тегом и назначенным пунктом плана
    if (!thought.outlinePointId) return false; // Если нет назначенного пункта плана, нет и проблемы
    
    // Определяем секцию пункта плана
    let outlinePointSection: string | undefined;
    
    if (sermon.outline!.introduction.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'introduction';
    } else if (sermon.outline!.main.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'main';
    } else if (sermon.outline!.conclusion.some(p => p.id === thought.outlinePointId)) {
      outlinePointSection = 'conclusion';
    }
    
    if (!outlinePointSection) return false; // Если не нашли секцию, считаем что проблемы нет
    
    // Получаем ожидаемый тег для текущей секции
    const expectedTag = getCanonicalTagForSection(outlinePointSection as 'introduction' | 'main' | 'conclusion');
    
    // Проверяем, имеет ли мысль тег соответствующей секции
    const hasExpectedTag = thought.tags.some(tag => normalizeStructureTag(tag) === expectedTag);
    
    // Проверяем, имеет ли мысль теги других секций
    const hasOtherSectionTags = ['intro', 'main', 'conclusion']
      .filter(tag => tag !== expectedTag)
      .some(tag => thought.tags.some(t => normalizeStructureTag(t) === tag));
    
    // Несогласованность, если нет ожидаемого тега или есть теги других секций
    return !(!hasOtherSectionTags || hasExpectedTag);
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

  it('returns false when all thoughts have consistent tags and assignments', () => {
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
        },
        {
          id: 'thought-4',
          text: 'Unassigned thought',
          tags: ['Вступление'],
          date: '2023-01-01'
          // No outlinePointId
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
