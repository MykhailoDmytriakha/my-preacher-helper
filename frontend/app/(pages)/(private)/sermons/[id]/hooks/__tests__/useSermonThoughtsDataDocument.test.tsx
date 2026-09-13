import { renderHook } from '@testing-library/react';

import { useDataDocument, useDataEngine } from '@/data-engine/react.client';
import { applyCommand } from '@/data-engine/protocol';
import { DataSession } from '@/data-engine/session';

import { useSermonThoughtsDataDocument } from '../useSermonThoughtsDataDocument';

import type { ThoughtFieldPatch } from '../useSermonThoughtsDataDocument';
import type { DocumentData, ResourceSnapshot } from '@/data-engine/types';
import type { Thought } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({ useDataDocument: jest.fn(), useDataEngine: jest.fn() }));
const thought = (id: string, text = id): Thought => ({ id, text, tags: [], date: '2026-09-12' });
const snapshot = (): ResourceSnapshot => ({ resource: { collection: 'sermons', id: 'sermon' }, metadata: null,
  value: { userId: 'owner', title: 'Title', date: '2026-09-12', verse: 'John 1', thoughts: [thought('a'), thought('b')],
    outline: { introduction: [{ id: 'intro', text: 'Opening' }], main: [{ id: 'main', text: 'Body' }], conclusion: [] },
    structure: { introduction: [], main: [], conclusion: [], ambiguous: ['b', 'a'] } } as unknown as DocumentData });
function setup(value: ResourceSnapshot = snapshot()) {
  const session = new DataSession(value);
  const api = {
    data: value.value, confirmed: value, remote: null, state: null, status: null, loading: false, error: null,
    commit: jest.fn(),
    update: jest.fn(async (mutate: (current: DocumentData | null) => DocumentData | null) => {
      session.edit(mutate(session.checkpoint().draft));
    }), save: jest.fn(async () => undefined), edit: jest.fn(), remove: jest.fn(), retry: jest.fn(),
    keepLocal: jest.fn(), acceptRemote: jest.fn(), getManualForm: jest.fn(), listRecoverable: jest.fn(), recover: jest.fn(),
  } as ReturnType<typeof useDataDocument>;
  api.commit = jest.fn(async updater => {
    const staged = api.update(updater);
    await staged;
    await api.save();
  });
  jest.mocked(useDataDocument).mockReturnValue(api);
  jest.mocked(useDataEngine).mockReturnValue({ owner: 'owner', browser: null, error: null });
  const hook = renderHook(() => useSermonThoughtsDataDocument('sermon'));
  return { session, api, ...hook };
}

describe('thoughts use the shared document editor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds the stable thought ID and both placement aliases in one command', async () => {
    const s = setup();
    await expect(s.result.current.addThought({ ...thought('new'), outlinePointId: 'main' })).resolves.toEqual({ delivery: 'queued' });
    const command = s.session.prepare('operation', 'owner');
    expect(command?.kind).toBe('update');
    if (command?.kind !== 'update') throw new Error('Expected one update');
    expect(command.changes.map(change => change.path[0]).sort()).toEqual(['structure', 'thoughts', 'thoughtsBySection']);
    const result = applyCommand(command, snapshot());
    expect(result.kind).toBe('acknowledged');
    if (result.kind !== 'acknowledged') throw new Error('Expected acceptance');
    expect(result.snapshot.value?.structure).toEqual(result.snapshot.value?.thoughtsBySection);
    expect(result.snapshot.value?.structure).toMatchObject({ main: ['new'], ambiguous: ['b', 'a'] });
    expect(s.api.save).toHaveBeenCalledTimes(1);
  });

  it('retains two same-tick edits and only repositions a thought when placement changes', async () => {
    const s = setup();
    await Promise.all([s.result.current.patchThought('a', { text: 'New a' }), s.result.current.patchThought('b', { text: 'New b' })]);
    expect(s.session.checkpoint().draft?.thoughts).toEqual([thought('a', 'New a'), thought('b', 'New b')]);
    expect(s.session.checkpoint().draft?.structure).toEqual(snapshot().value?.structure);
    await s.result.current.patchThought('a', { outlinePointId: 'intro' });
    expect(s.session.checkpoint().draft?.structure).toMatchObject({ introduction: ['a'], ambiguous: ['b'] });
    expect(s.session.checkpoint().draft?.thoughts).toEqual([{ ...thought('a', 'New a'), outlinePointId: 'intro', subPointId: null }, thought('b', 'New b')]);
  });

  it('preserves an explicit subpoint and removes optional fields without writing undefined', async () => {
    const s = setup();
    await s.result.current.patchThought('a', { outlinePointId: 'main', subPointId: 'sub', isLocked: true });
    await s.result.current.patchThought('a', { isLocked: undefined });
    expect(s.session.checkpoint().draft?.thoughts).toEqual([{ ...thought('a'), outlinePointId: 'main', subPointId: 'sub' }, thought('b')]);
  });

  it('removes a thought and all placement entries together without changing its sibling', async () => {
    const s = setup();
    await s.result.current.deleteThought('b');
    const state = s.session.checkpoint().draft;
    expect(state?.thoughts).toEqual([thought('a')]);
    expect(state?.structure).toEqual(state?.thoughtsBySection);
    expect(state?.structure).toMatchObject({ ambiguous: ['a'] });
    await s.result.current.deleteThought('missing');
    expect(s.session.checkpoint().draft).toEqual(state);
  });

  it('merges an independent remote thought edit without splitting placement from content', async () => {
    const s = setup();
    await s.result.current.patchThought('a', { outlinePointId: 'main', text: 'Local a' });
    const remote = snapshot();
    remote.value!.thoughts = [thought('a'), thought('b', 'Remote b')] as unknown as DocumentData['thoughts'];
    const command = s.session.prepare('op', 'owner');
    const result = applyCommand(command!, remote);
    expect(result.kind).toBe('acknowledged');
    if (result.kind !== 'acknowledged') throw new Error('Expected acceptance');
    expect(result.snapshot.value?.thoughts).toEqual([{ ...thought('a', 'Local a'), outlinePointId: 'main', subPointId: null }, thought('b', 'Remote b')]);
    expect(result.snapshot.value?.structure).toMatchObject({ main: ['a'] });
  });

  it('does not duplicate retries with the same ID or resurrect an absent thought', async () => {
    const s = setup();
    await s.result.current.addThought({ tags: [], date: '2026-09-12', text: 'a', id: 'a' });
    expect(s.session.checkpoint().dirty).toBe(false);
    await expect(s.result.current.addThought(thought('a', 'different'))).rejects.toThrow('already uses this ID');
    await expect(s.result.current.patchThought('missing', { text: 'Do not resurrect' })).rejects.toThrow('deleted');
    await expect(s.result.current.patchThought('a', { id: 'renamed' } as ThoughtFieldPatch)).rejects.toThrow('Unsupported');
    expect(s.session.checkpoint().dirty).toBe(false);
  });

  it('uses the modern placement alias when the legacy alias is absent', async () => {
    const base = snapshot(); base.value!.thoughtsBySection = base.value!.structure; delete base.value!.structure;
    const s = setup(base);
    await s.result.current.deleteThought('b');
    expect(s.session.checkpoint().draft?.structure).toMatchObject({ ambiguous: ['a'] });
    await s.result.current.addThought(thought('new'));
    expect(s.session.checkpoint().draft?.thoughtsBySection).toEqual(s.session.checkpoint().draft?.structure);
  });

  it('locks absent, foreign and deleted documents and forwards local storage refusal', async () => {
    const missing = setup({ ...snapshot(), value: null });
    expect(missing.result.current.thoughts).toEqual([]);
    await expect(missing.result.current.addThought(thought('x'))).rejects.toThrow('not available');
    missing.unmount();
    const foreign = snapshot(); foreign.value!.userId = 'other';
    const other = setup(foreign);
    await expect(other.result.current.patchThought('a', { text: 'wrong owner' })).rejects.toThrow('not available');
    other.unmount();
    const s = setup();
    jest.mocked(s.api.update).mockRejectedValueOnce(new Error('Disk full'));
    await expect(s.result.current.deleteThought('a')).rejects.toThrow('Disk full');
    expect(s.api.save).not.toHaveBeenCalled();
  });
});
