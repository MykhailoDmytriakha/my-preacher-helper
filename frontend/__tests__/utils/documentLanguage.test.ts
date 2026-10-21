import { groupLanguage, sermonLanguage } from '@/utils/documentLanguage';

import type { Group, Sermon } from '@/models/models';

/*
 * A sermon's language is read off all of its words — the plan as shown and the scratch notes too, not
 * only its title, verse and thoughts: the sermon header, preaching and the search for its uses must
 * read "1Цар 3:5" alike (Codex, 2026-10-21; case 2026-10-12-block-diagram, 2.2.1).
 */
const sermon = (value: Partial<Sermon>): Sermon => ({ id: 's', userId: 'u', title: 'Соломон', verse: '1Цар 3:5', date: '', thoughts: [], ...value });

describe('sermonLanguage', () => {
  it('reads the plan as it is shown', () => {
    expect(sermonLanguage(sermon({ outline: { introduction: [{ id: 'i1', text: 'Вступ' }], main: [], conclusion: [] }, planText: { i1: 'Мій Господь з’явився уві сні' } }))).toBe('uk');
  });

  it('reads the scratch notes', () => {
    expect(sermonLanguage(sermon({ scratch: [{ id: 'n1', text: 'Мій Господь з’явився уві сні', createdAt: '' } as never] }))).toBe('uk');
  });

  it('says nothing for words that do not tell Russian from Ukrainian', () => {
    expect(sermonLanguage(sermon({}))).toBeNull();
  });
});

describe('groupLanguage', () => {
  it('reads the leader\'s own titles and notes in the flow', () => {
    const group = { title: 'Соломон', description: '', templates: [{ id: 't', type: 'topic', title: 'Соломон', content: '1Цар 3:5', status: 'filled', createdAt: '', updatedAt: '' }],
      flow: [{ id: 'f', templateId: 't', order: 1, instanceNotes: 'Мій Господь з’явився уві сні — 1Цар 3:5' }] } as unknown as Group;
    expect(groupLanguage(group)).toBe('uk');
  });
});
