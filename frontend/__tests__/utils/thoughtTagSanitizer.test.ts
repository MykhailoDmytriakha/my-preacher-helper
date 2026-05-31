import {
  sanitizeAvailableThoughtTags,
  sanitizeThoughtTags,
  stripStructureTags,
} from '@/utils/thoughtTagSanitizer';

describe('thoughtTagSanitizer', () => {
  it('removes deprecated structural tags from persisted tag arrays', () => {
    expect(stripStructureTags([
      'Основная часть',
      'Примеры',
      'main',
      'Объяснение',
      'Conclusion',
      'Примеры',
    ])).toEqual(['Примеры', 'Объяснение']);
  });

  it('removes structural tags from available AI tags', () => {
    expect(sanitizeAvailableThoughtTags([
      'Вступление',
      'Стих',
      'Main Part',
      'Применение',
      'conclusion',
    ])).toEqual(['Стих', 'Применение']);
  });

  it('keeps only auxiliary model tags that exist in the available tag list', () => {
    expect(sanitizeThoughtTags(
      ['основная часть', 'стих', 'Unknown', 'Примеры', 'СТИХ'],
      ['Стих', 'Примеры', 'Объяснение']
    )).toEqual(['Стих', 'Примеры']);
  });
});
