import { buildSortItemKeys, createSortingUserMessage } from '@/config/prompts';

import type { Sermon } from '@/models/models';

describe('buildSortItemKeys', () => {
  it('shows the model four characters when they already tell every thought apart', () => {
    const keys = buildSortItemKeys([{ id: 'abcd-1' }, { id: 'efgh-2' }]);
    expect([...keys.values()]).toEqual(['abcd', 'efgh']);
  });

  it('lengthens every key just enough when two ids begin alike', () => {
    const keys = buildSortItemKeys([{ id: 'abcd1111' }, { id: 'abcd2222' }, { id: 'efgh3333' }]);
    expect([...keys.values()]).toEqual(['abcd1', 'abcd2', 'efgh3']);
  });

  it('gives distinct keys even when one id is the start of another', () => {
    const keys = buildSortItemKeys([{ id: 'abcd' }, { id: 'abcde' }]);
    expect(new Set(keys.values()).size).toBe(2);
  });
});

describe('createSortingUserMessage', () => {
  it('lists the same distinct keys the answer is parsed with', () => {
    const items = [
      { id: 'abcd1111', content: 'First', customTagNames: [] },
      { id: 'abcd2222', content: 'Second', customTagNames: [] },
    ];
    const message = createSortingUserMessage('main', items as never, { title: 'T', verse: 'V' } as Sermon);
    expect(message).toContain('key: abcd1,');
    expect(message).toContain('key: abcd2,');
  });
});

describe('the sorting protocol', () => {
  it('asks the model for the key exactly as shown, never for "the first 4 characters"', () => {
    const { sortingSystemPrompt } = jest.requireActual('@/config/prompts') as { sortingSystemPrompt: string };
    const { SortedItemSchema } = jest.requireActual('@/config/schemas/zod/sorting.zod') as { SortedItemSchema: { shape: { key: { description?: string } } } };
    const message = createSortingUserMessage('main', [{ id: 'abcd1111', content: 'x', customTagNames: [] }] as never, { title: 'T', verse: 'V' } as Sermon);
    for (const text of [sortingSystemPrompt, message, SortedItemSchema.shape.key.description ?? '']) {
      expect(text).not.toMatch(/first 4 characters/i);
    }
    expect(SortedItemSchema.shape.key.description).toMatch(/exactly as shown/i);
  });
});

