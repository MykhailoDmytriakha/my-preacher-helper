import { formatScriptureReference } from '@/utils/scriptureReference';
import { scriptureReferencesOverlap } from '@/utils/scriptureReferenceNumbering';
import { findScriptureUsage } from '@/utils/scriptureUsage';

import type { Group, Sermon, StudyNote } from '@/models/models';
import type { ScriptureRefShape } from '@/utils/scriptureReference';

const target: ScriptureRefShape = { bible: 'kjv', book: '1 Chronicles', chapter: 1, fromVerse: 10 };
const note = (id: string, refs: ScriptureRefShape[], content = ''): StudyNote => ({ id, title: id, userId: 'owner', content,
  scriptureRefs: refs.map((ref, index) => ({ ...ref, id: String(index) })), tags: [], createdAt: '', updatedAt: '', isDraft: false });
const sermon = (value: Partial<Sermon>): Sermon => ({ id: 'sermon', title: 'Sermon', userId: 'owner', verse: '', date: '', thoughts: [], ...value });
const search = (notes: StudyNote[] = [], sermons: Sermon[] = [], groups: Group[] = [], reference = target) =>
  findScriptureUsage(reference, { notes, sermons, groups, currentNoteId: 'current', locale: 'en' });

describe('explicit Scripture uses across personal materials', () => {
  it('excludes the current note, deduplicates mentions and includes overlapping ranges', () => {
    const results = search([note('current', [target]), note('exact', [target, target]),
      note('range', [{ ...target, fromVerse: 1, toVerse: 11 }]), note('neighbor', [{ ...target, fromVerse: 11 }])]);
    expect(results.map(item => [item.id, item.match])).toEqual([['exact', 'same'], ['range', 'overlap']]);
  });

  it('finds a mention in the body and shows context around that actual mention', () => {
    const body = `${'Unrelated opening. '.repeat(60)}Read 1 Chr 1:10 before discussing Nimrod.`;
    const results = search([note('body', [], body)]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ match: 'text', href: '/studies/body' });
    expect(results[0].excerpt).toContain('1 Chr 1:10');
    expect(results[0].excerpt.length).toBeLessThan(330);
    expect(results[0].content).toBe(body);
    expect(search([note('structured', [target], body)])[0].excerpt).toContain('1 Chr 1:10');
  });

  it('matches the same Psalm across Bibles and rejects the neighboring verse', () => {
    const synodal: ScriptureRefShape = { bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 };
    const kjv: ScriptureRefShape = { bible: 'kjv', book: 'Psalms', chapter: 51, fromVerse: 10 };
    expect(search([note('same', [kjv]), note('next', [{ ...kjv, fromVerse: 11 }])], [], [], synodal).map(item => item.id)).toEqual(['same']);
    expect(formatScriptureReference(synodal, { locale: 'ru' })).toBe('Пс.50:12');
    expect(formatScriptureReference(synodal, { locale: 'en' })).toBe('Ps.51:10');
  });

  it('searches the plan actually rendered, while ignoring orphaned cells and indirect source links', () => {
    const results = search([], [
      sermon({ id: 'main', verse: '1 Chr 1:10' }),
      sermon({ id: 'plan', outline: { introduction: [], main: [{ id: 'p', text: 'Point' }], conclusion: [] }, planText: { p: 'Read 1 Chr 1:10.' } }),
      sermon({ id: 'orphan', planText: { removed: '1 Chr 1:10' } }),
      sermon({ id: 'linked', sourceNoteIds: ['current'] }),
    ]);
    expect(results.map(item => [item.id, item.match])).toEqual([['main', 'same'], ['plan', 'text']]);
  });

  it('finds group block references and counts a group once', () => {
    const group: Group = { id: 'g', userId: 'owner', title: 'Group', status: 'draft', flow: [], createdAt: '', updatedAt: '', templates: [
      { id: 'b1', type: 'scripture', title: 'Reading', content: 'Read together.', scriptureRefs: ['1 Chr 1:1-11'], status: 'filled', createdAt: '', updatedAt: '' },
      { id: 'b2', type: 'scripture', title: 'Discussion', content: 'Discuss 1 Chr 1:10.', status: 'filled', createdAt: '', updatedAt: '' },
    ] };
    expect(search([], [], [group])).toMatchObject([{ id: 'g', kind: 'group', match: 'overlap', href: '/groups/g' }]);
  });

  it('gives a row plain words around the mention, not the Markdown that writes it', () => {
    const body = '## Plan\n\nIntro line.\n\n### Nimrod\n- A **mighty** hunter\n- Read *1 Chr 1:10* aloud\n\n> Quote';
    const [result] = search([note('marked', [], body)]);
    expect(result.excerpt).toBe('Plan · Intro line. Nimrod · A mighty hunter · Read 1 Chr 1:10 aloud · Quote');
    expect(result.content).toBe(body);
  });

  it('starts a long excerpt near the mention and on a word boundary', () => {
    const body = `${'Opening words here. '.repeat(30)}Then 1 Chr 1:10 is read.`;
    const [result] = search([note('long', [], body)]);
    expect(result.excerpt).toMatch(/^…(Opening|words|here\.) /);
    expect(result.excerpt).toContain('1 Chr 1:10 is read.');
    expect(result.excerpt.indexOf('1 Chr 1:10')).toBeLessThan(80);
  });

  it('puts direct references first, then overlapping passages, then mentions; newer first within each', () => {
    const dated = (value: StudyNote, updatedAt: string) => ({ ...value, updatedAt });
    const results = search([
      dated(note('old-range', [{ ...target, fromVerse: 1, toVerse: 11 }]), '2025-01-01'),
      dated(note('new-mention', [], 'See 1 Chr 1:10.'), '2026-10-18'),
      dated(note('old-same', [target]), '2024-05-05'),
      dated(note('new-range', [{ ...target, fromVerse: 9, toVerse: 12 }]), '2026-10-01'),
    ]);
    expect(results.map(item => item.id)).toEqual(['old-same', 'new-range', 'old-range', 'new-mention']);
  });

  it('gives a note its strongest link, not its first one', () => {
    const results = search([note('both', [{ ...target, fromVerse: 1, toVerse: 11 }, target])]);
    expect(results.map(item => [item.id, item.match])).toEqual([['both', 'same']]);
  });

  it('points the preview at the mention of the opened passage, not at another verse of the same range', () => {
    const [result] = search([note('range', [{ ...target, fromVerse: 1, toVerse: 11 }], 'First 1 Chr 1:1 opens the list. Later 1 Chr 1:10 names Nimrod.')]);
    expect(result.mention).toBe('1 Chr 1:10');
    expect(result.excerpt).toContain('1 Chr 1:10 names Nimrod');
  });

  it('keeps the words that name the passage, so a preview can find them in the note', () => {
    const results = search([
      note('typed', [], 'Long text, then 1 Chr 1:10 near the end.'),
      note('listed-and-typed', [target], 'Opening. Read 1 Chr. 1:10 together.'),
      note('listed-only', [target], 'Nothing names it here.'),
    ]);
    expect(Object.fromEntries(results.map(item => [item.id, item.mention]))).toEqual({
      typed: '1 Chr 1:10', 'listed-and-typed': '1 Chr. 1:10', 'listed-only': undefined,
    });
  });

  it('does not collapse a passage split across chapters into one approximate range', () => {
    const mapped: ScriptureRefShape = { bible: 'kjv', book: 'Romans', chapter: 16, fromVerse: 24, toVerse: 27 };
    expect(scriptureReferencesOverlap(mapped, { bible: 'rst', book: 'Romans', chapter: 14, fromVerse: 24 })).toBe(true);
    expect(scriptureReferencesOverlap(mapped, { bible: 'rst', book: 'Romans', chapter: 15 })).toBe(false);
  });
});

// A note's title says its language for a reference its body alone does not (Codex, 2026-10-21).
describe('a typed reference among personal materials', () => {
  it('reads "1Цар 3:5" of a note titled in Ukrainian as 1 Kings, not 1 Samuel', () => {
    const ukrainian: StudyNote = { ...note('ukrainian', [], '1Цар 3:5'), title: 'Мій Господь' };
    const find = (book: string) => findScriptureUsage({ bible: 'kjv', book, chapter: 3, fromVerse: 5 }, { notes: [ukrainian], sermons: [], groups: [], currentNoteId: 'current', locale: 'ru' });
    expect(find('1 Kings').map(item => item.id)).toEqual(['ukrainian']);
    expect(find('1 Samuel')).toEqual([]);
  });
});
