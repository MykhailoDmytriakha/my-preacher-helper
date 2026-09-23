import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';

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

  it('merges a plan by point, keeping a point added elsewhere', async () => {
    const opened: SermonOutline = { introduction: [], main: [{ id: 'p1', text: 'One' }], conclusion: [] };
    const { state, writer } = draft({ ...base(), outline: { ...opened, main: [{ id: 'p1', text: 'One' }, { id: 'p2', text: 'Added on the phone' }] } } as unknown as DocumentData);
    const saved = await writer.updateSermonOutline('s1', { ...opened, main: [{ id: 'p1', text: 'One, renamed' }] }, opened, 'preferMine');
    expect(saved?.main.map(point => point.text)).toEqual(['One, renamed', 'Added on the phone']);
    expect((state.current!.outline as unknown as SermonOutline).main).toHaveLength(2);
  });

  it('refuses a document of another owner instead of writing into it', async () => {
    const { writer } = draft({ ...base(), userId: 'someone-else' } as unknown as DocumentData);
    await expect(writer.updateStructure('s1', structure({ main: ['a'] }), null)).rejects.toThrow('not available');
  });
});
