import type { Sermon, Thought } from '@/models/models';

export const exportThought = (id: string, extra: Partial<Thought> = {}): Thought => ({ id, text: id, tags: [], date: '2026-01-01', ...extra });
export const exportSermon = (extra: Partial<Sermon> = {}): Sermon => ({
  id: 'export-contract', userId: 'user', title: 'Test sermon', verse: 'John 1:1', date: '2026-01-01', thoughts: [], ...extra,
});

export const numberedExportSermon = (): Sermon => exportSermon({
  outline: {
    introduction: [{ id: 'i1', text: 'Intro point' }],
    main: [
      { id: 'm1', text: 'Main point', subPoints: [{ id: 'sub', text: 'Sub point', position: 2000 }] },
      { id: 'm2', text: 'Next point' },
    ],
    conclusion: [{ id: 'c1', text: 'Conclusion point' }],
  },
  thoughts: [
    exportThought('intro', { tags: ['Introduction'], outlinePointId: 'i1' }),
    exportThought('after', { tags: ['main'], outlinePointId: 'm1', position: 3000 }),
    exportThought('sub', { text: 'Sub thought\nContinued\n\nParagraph', tags: ['main'], outlinePointId: 'm1', subPointId: 'sub', position: 1500 }),
    exportThought('before', { tags: ['main'], outlinePointId: 'm1', position: 1000 }),
    exportThought('next', { tags: ['main'], outlinePointId: 'm2' }),
    exportThought('conclusion', { tags: ['conclusion'], outlinePointId: 'c1' }),
  ],
  structure: { introduction: ['intro'], main: ['after', 'sub', 'before', 'next'], conclusion: ['conclusion'], ambiguous: [] },
});
