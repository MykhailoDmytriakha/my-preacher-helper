import type { Sermon, Thought } from '@/models/models';
import {
  getVisualOrderedThoughtsBySection,
  getVisualOrderedThoughtsForOutlinePoint,
  normalizeVisualSectionKey,
} from '@/utils/sermonVisualOrder';

describe('sermonVisualOrder', () => {
  const thought = (id: string, extra: Partial<Thought> = {}): Thought => ({
    id,
    text: id,
    tags: ['main'],
    date: `2024-01-01T00:00:0${id.length}Z`,
    ...extra,
  });

  it('uses the same outline/sub-point position interleave as Structure and Plan', () => {
    const sermon: Sermon = {
      id: 'sermon-visual',
      title: 'Visual order',
      verse: '',
      date: '2024-01-01',
      userId: 'user-1',
      outline: {
        introduction: [],
        main: [
          {
            id: 'point-1',
            text: 'Main point',
            subPoints: [{ id: 'sub-1', text: 'Sub point', position: 2000 }],
          },
        ],
        conclusion: [],
      },
      thoughts: [
        thought('after', { outlinePointId: 'point-1', position: 3000 }),
        thought('sub', { outlinePointId: 'point-1', subPointId: 'sub-1', position: 1500 }),
        thought('before', { outlinePointId: 'point-1', position: 1000 }),
      ],
      structure: {
        introduction: [],
        main: ['after', 'sub', 'before'],
        conclusion: [],
        ambiguous: [],
      },
    };

    expect(getVisualOrderedThoughtsBySection(sermon, 'main').map((item) => item.id)).toEqual([
      'before',
      'sub',
      'after',
    ]);
    expect(getVisualOrderedThoughtsForOutlinePoint(sermon, 'point-1').map((item) => item.id)).toEqual([
      'before',
      'sub',
      'after',
    ]);
  });

  it('normalizes audio/UI section aliases to the structure section key', () => {
    expect(normalizeVisualSectionKey('mainPart')).toBe('main');
    expect(normalizeVisualSectionKey('main')).toBe('main');
    expect(normalizeVisualSectionKey('unknown')).toBeNull();
  });
});
