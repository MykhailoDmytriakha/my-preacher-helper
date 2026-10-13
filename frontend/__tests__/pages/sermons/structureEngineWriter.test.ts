import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { preservesSermonLinks } from '@/data-engine/sermonIntegrity';

import type { DocumentData } from '@/data-engine/types';
import type { SermonOutline, Thought, ThoughtsBySection } from '@/models/models';

const thought = (id: string, text: string, extra: Partial<Thought> = {}): Thought => ({ id, text, tags: [], date: '2026-09-22', ...extra });
const structure = (value: Partial<ThoughtsBySection>): ThoughtsBySection => ({ introduction: [], main: [], conclusion: [], ambiguous: [], ...value });

/** An editor draft the writer edits through `update`, exactly as the engine hands it over. */
function draft(initial: DocumentData) {
  const state = { current: initial as DocumentData | null };
  const document = { update: async (updater: (current: DocumentData | null) => DocumentData | null) => { state.current = updater(state.current); } };
  return { state, writer: createEngineStructureWriter(document, 'owner-1') };
}

const base = () => ({
  userId: 'owner-1', title: 'Grace', verse: 'John 1:14', date: '2026-09-01',
  thoughts: [thought('a', 'First'), thought('b', 'Second')],
  structure: structure({ introduction: ['a'], main: ['b'] }),
  thoughtsBySection: structure({ introduction: ['a'], main: ['b'] }),
}) as unknown as DocumentData;

describe('structure writes on an engine document', () => {
  it('keeps a move made in another tab while laying this screen\'s own move over the current copy', async () => {
    const { state, writer } = draft(base());
    const opened = structure({ introduction: ['a'], main: ['b'] });
    // Another tab moved "b" to the conclusion after this screen opened.
    state.current = { ...state.current!, structure: structure({ introduction: ['a'], conclusion: ['b'] }) as unknown as DocumentData };
    // This screen moved "a" into the main section.
    await writer.updateStructure('s1', structure({ main: ['a', 'b'] }), opened);
    expect(state.current!.structure).toEqual(expect.objectContaining({ main: ['a'], conclusion: ['b'], introduction: [] }));
    expect(state.current!.thoughtsBySection).toEqual(state.current!.structure);
  });

  it('states only the fields this screen changed, so a text rewritten elsewhere survives a drag', async () => {
    const { state, writer } = draft(base());
    const opened = thought('b', 'Second');
    state.current = { ...state.current!, thoughts: [thought('a', 'First'), thought('b', 'Rewritten on the phone')] as unknown as DocumentData[] };
    const confirmed = await writer.updateThought('s1', { ...opened, position: 2000 }, opened);
    expect(confirmed).toEqual(expect.objectContaining({ id: 'b', text: 'Rewritten on the phone', position: 2000 }));
  });

  it('adds a thought with its place and removes one from every section', async () => {
    const { state, writer } = draft(base());
    await writer.createManualThought('s1', thought('c', 'Third', { tags: ['main'] }));
    expect((state.current!.thoughts as unknown as Thought[]).map(item => item.id)).toContain('c');
    await writer.deleteThought('s1', thought('a', 'First'));
    const sections = state.current!.structure as unknown as ThoughtsBySection;
    expect(Object.values(sections).flat()).not.toContain('a');
    expect((state.current!.thoughts as unknown as Thought[]).map(item => item.id)).not.toContain('a');
  });

  it('creates a thought added in a column in that column, though it carries no section tag', async () => {
    // The board's "add thought" in a column: the thought has no tag, the column is its place. The
    // document placed it by tags alone (under review), and the board, rebuilt from the document
    // before its follow-up structure save, then saved it there too. It must be born in its column.
    const { state, writer } = draft({ ...base(), thoughts: [], structure: undefined, thoughtsBySection: undefined } as unknown as DocumentData);
    await writer.createManualThought('s1', thought('c', 'From the introduction column'), 'introduction');
    const sections = state.current!.structure as unknown as ThoughtsBySection;
    expect(sections.introduction).toEqual(['c']);
    expect(sections.ambiguous ?? []).not.toContain('c');
  });

  it('still places a thought created without a column by its tags', async () => {
    const { state, writer } = draft(base());
    await writer.createManualThought('s1', thought('c', 'Tagged main', { tags: ['main'] }));
    expect((state.current!.structure as unknown as ThoughtsBySection).main).toContain('c');
  });

  it('keeps the two sections a board column never read when it hands over its own (BUG-20261010-column-outline-save-cancelled-on-leave)', async () => {
    // The column knows only its section; the other two go in as the same empty placeholder on both
    // sides of the merge, so the document's points there must survive the edit.
    const stored: SermonOutline = {
      introduction: [{ id: 'i1', text: 'Opening story' }],
      main: [{ id: 'm1', text: 'Point' }],
      conclusion: [{ id: 'c1', text: 'Call to act' }],
    };
    const { state, writer } = draft({ ...base(), outline: stored } as unknown as DocumentData);
    const placeholder = { introduction: [], conclusion: [] };
    const saved = await writer.updateSermonOutline('s1', { ...placeholder, main: [{ id: 'm1', text: 'Point, renamed' }] },
      { ...placeholder, main: [{ id: 'm1', text: 'Point' }] }, 'preferMine');
    expect(state.current!.outline).toEqual({ ...stored, main: [{ id: 'm1', text: 'Point, renamed' }] });
    expect(saved).toEqual(state.current!.outline);
  });

  it('merges a plan by point, keeping a point added elsewhere', async () => {
    const opened: SermonOutline = { introduction: [], main: [{ id: 'p1', text: 'One' }], conclusion: [] };
    const { state, writer } = draft({ ...base(), outline: { ...opened, main: [{ id: 'p1', text: 'One' }, { id: 'p2', text: 'Added on the phone' }] } } as unknown as DocumentData);
    const saved = await writer.updateSermonOutline('s1', { ...opened, main: [{ id: 'p1', text: 'One, renamed' }] }, opened, 'preferMine');
    expect(saved?.main.map(point => point.text)).toEqual(['One, renamed', 'Added on the phone']);
    expect((state.current!.outline as unknown as SermonOutline).main).toHaveLength(2);
  });

  it('never places a thought deleted on another device, so the server has nothing to refuse', async () => {
    const { state, writer } = draft(base());
    const opened = structure({ introduction: ['a'], main: ['b'] });
    // The phone deleted "b"; this board still shows it and moves "a" next to it.
    state.current = { ...state.current!, thoughts: [thought('a', 'First')] as unknown as DocumentData[],
      structure: structure({ introduction: ['a'] }) as unknown as DocumentData };
    const before = state.current!;
    await writer.updateStructure('s1', structure({ main: ['a', 'b', 'a'] }), opened);
    expect(state.current!.structure).toEqual(expect.objectContaining({ introduction: [], main: ['a'] }));
    // The server's own integrity rule accepts the result.
    expect(preservesSermonLinks(before, state.current!)).toBe(true);
  });

  it('refuses a document of another owner instead of writing into it', async () => {
    const { writer } = draft({ ...base(), userId: 'someone-else' } as unknown as DocumentData);
    await expect(writer.updateStructure('s1', structure({ main: ['a'] }), null)).rejects.toThrow('not available');
  });

  it('keeps a sub-point rewritten on the phone when this board rewrites another sub-point of the same point (BUG-20261011-outline-point-merge-loses-subpoint-edit)', async () => {
    const subs = (x: string, y: string) => [{ id: 'sx', text: x, position: 1 }, { id: 'sy', text: y, position: 2 }];
    const opened: SermonOutline = { introduction: [], main: [{ id: 'm1', text: 'Point', subPoints: subs('X', 'Y') }], conclusion: [] };
    const { state, writer } = draft({ ...base(), outline: opened as unknown as DocumentData });
    // The phone's rewrite of sub-point Y reached this document before the board handed its edit over.
    state.current = { ...state.current!, outline: { ...opened, main: [{ id: 'm1', text: 'Point', subPoints: subs('X', 'Y on the phone') }] } as unknown as DocumentData };

    await writer.updateSermonOutline('s1', { ...opened, main: [{ id: 'm1', text: 'Point', subPoints: subs('X on the board', 'Y') }] }, opened);

    const main = (state.current!.outline as unknown as SermonOutline).main;
    expect(main[0].subPoints?.map(sub => sub.text)).toEqual(['X on the board', 'Y on the phone']);
  });
});
