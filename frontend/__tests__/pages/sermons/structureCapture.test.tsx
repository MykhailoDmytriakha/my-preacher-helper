import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import React, { useRef, useState } from 'react';

import { useSermonActions } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions';
import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import EditThoughtModal from '@/components/EditThoughtModal';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';

import type { DocumentData } from '@/data-engine/types';
import type { Item, Sermon, Thought } from '@/models/models';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/hooks/useScrollLock', () => ({ useScrollLock: jest.fn() }));
jest.mock('@/hooks/useTextDictation', () => ({ useTextDictation: () => ({
  isProcessing: false, isRecording: false, error: null, accept: jest.fn(),
  captureAcceptance: () => jest.fn().mockResolvedValue(undefined),
}) }));
jest.mock('@/components/thought/ThoughtTextHeader', () => ({ ThoughtTextHeader: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    <textarea aria-label="Thought text" value={value} onChange={event => onChange(event.target.value)} />,
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({
  'editThought.editTitle': 'Edit Thought', 'buttons.save': 'Save', 'buttons.saving': 'Saving', 'buttons.cancel': 'Cancel',
}[key] ?? key) }) }));

const thought: Thought = { id: 'existing', text: 'Original words', tags: [], date: '2026-10-19' };
const item: Item = { id: 'existing', content: 'Original words', requiredTags: [], customTagNames: [] };
const initial: Sermon = { id: 'sermon', title: 'Grace', verse: 'John 1:14', date: '2026-10-19', userId: 'owner',
  thoughts: [thought], structure: { introduction: [], main: ['existing'], conclusion: [], ambiguous: [] } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Harness() {
  const [sermon, setSermon] = useState<Sermon | null>(initial);
  const [containers, setContainers] = useState<Record<string, Item[]>>({ introduction: [], main: [item], conclusion: [], ambiguous: [] });
  const containersRef = useRef(containers);
  const actions = useSermonActions({ sermon, setSermon, containers, setContainers, containersRef,
    allowedTags: [], debouncedSaveThought: jest.fn(), debouncedSaveStructure: jest.fn() });
  return <><button onClick={() => actions.handleAddThoughtToSection('main')}>New thought</button>
    <button onClick={() => actions.handleEdit(item)}>Edit thought</button>
    {actions.editingItem && <EditThoughtModal initialText={actions.editingItem.content} initialTags={[]}
      allowedTags={[]} onSave={actions.handleSaveEdit} onClose={actions.handleCloseEdit} />}</>;
}
function mount(writer: StructureWriter) {
  render(<StructureWriterContext.Provider value={writer}><Harness /></StructureWriterContext.Provider>);
}
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
const writerWith = (overrides: Partial<StructureWriter> = {}): StructureWriter => ({
  createManualThought: jest.fn(async (_id, value) => value), updateThought: jest.fn(async (_id, value) => value),
  deleteThought: jest.fn(async () => undefined), updateStructure: jest.fn(async () => undefined),
  updateSermonOutline: jest.fn(async () => null), ...overrides,
});

describe('structure thought editor durable capture', () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(['create', 'edit-online', 'edit-offline', 'delete-empty'] as const)(
    'retains the %s editor until the writer actually captures its change', async mode => {
      const pending = deferred<Thought>();
      const writer = writerWith({
        createManualThought: jest.fn((_id, value) => pending.promise.then(() => value)),
        updateThought: jest.fn((_id, value) => pending.promise.then(() => value)),
        deleteThought: jest.fn(() => pending.promise.then(() => undefined)),
      });
      jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(mode !== 'edit-offline');
      mount(writer);
      fireEvent.click(screen.getByRole('button', { name: mode === 'create' ? 'New thought' : 'Edit thought' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Thought text' }), { target: { value: mode === 'delete-empty' ? '' : 'Exact authored words' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await tick();
      const retained = screen.queryByRole('dialog', { name: 'Edit Thought' }) !== null;
      await act(async () => pending.resolve(thought));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(retained).toBe(true);
    }
  );
  it('keeps refused creation editable and reuses its thought identity on retry', async () => {
    const pending = deferred<Thought>();
    const create = jest.fn<ReturnType<StructureWriter['createManualThought']>, Parameters<StructureWriter['createManualThought']>>()
      .mockImplementationOnce((_id, value) => pending.promise.then(() => value))
      .mockImplementation(async (_id, value) => value);
    mount(writerWith({ createManualThought: create }));
    fireEvent.click(screen.getByRole('button', { name: 'New thought' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Thought text' }), { target: { value: 'Keep these exact words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await tick();
    await act(async () => pending.reject(new Error('Device storage refused capture')));
    expect(screen.getByRole('textbox', { name: 'Thought text' })).toHaveValue('Keep these exact words');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][1].id).toBe(create.mock.calls[0][1].id);
  });
});


it('continues the same creation when refused capture left its exact draft in the engine', async () => {
  let engineCopy: DocumentData | null = initial as unknown as DocumentData;
  const pending = deferred<void>();
  let first = true;
  const writer = createEngineStructureWriter({ update: change => {
    engineCopy = change(engineCopy);
    if (first) { first = false; return pending.promise; }
    return Promise.resolve();
  } }, 'owner');
  const hook = renderHook(() => useSermonActions({
    sermon: { ...engineCopy, id: 'sermon' } as unknown as Sermon,
    setSermon: jest.fn(), containers: { main: [item] }, containersRef: { current: { main: [item] } },
    setContainers: jest.fn(), allowedTags: [], debouncedSaveThought: jest.fn(), debouncedSaveStructure: jest.fn(),
  }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });
  act(() => hook.result.current.handleAddThoughtToSection('main'));
  let failed!: ReturnType<typeof hook.result.current.handleSaveEdit>;
  act(() => { failed = hook.result.current.handleSaveEdit('First attempt', []); });
  const { awaitWriteOperation } = await import('@/utils/recoverableWrite');
  await act(async () => {
    pending.reject(new Error('Device refused checkpoint'));
    await expect(awaitWriteOperation(failed, () => undefined)).rejects.toThrow('Device refused checkpoint');
  });
  const failedDraft = (engineCopy!.thoughts as unknown as Thought[]).find(value => value.id !== 'existing')!;
  expect(failedDraft.text).toBe('First attempt');
  hook.rerender();
  await act(async () => {
    await awaitWriteOperation(hook.result.current.handleSaveEdit('Revised after refusal', []), () => undefined);
  });
  const thoughts = engineCopy!.thoughts as unknown as Thought[];
  expect(thoughts).toHaveLength(2);
  expect(thoughts.find(value => value.id === failedDraft.id)).toMatchObject({
    text: 'Revised after refusal', date: failedDraft.date,
  });
  expect(new Set(Object.values(engineCopy!.structure as unknown as Record<string, string[]>).flat()).size).toBe(2);
});


it('retries an edited creation after its follow-up structure capture fails while the board still shows its opening copy', async () => {
  let engineCopy: DocumentData | null = initial as unknown as DocumentData;
  const failedStructure = deferred<void>();
  let writes = 0;
  const writer = createEngineStructureWriter({ update: change => {
    engineCopy = change(engineCopy);
    writes++;
    return writes === 2 ? failedStructure.promise : Promise.resolve();
  } }, 'owner');
  const hook = renderHook(() => useSermonActions({ sermon: initial, setSermon: jest.fn(),
    containers: { main: [item] }, containersRef: { current: { main: [item] } }, setContainers: jest.fn(),
    allowedTags: [], debouncedSaveThought: jest.fn(), debouncedSaveStructure: jest.fn(),
  }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });
  act(() => hook.result.current.handleAddThoughtToSection('main'));
  let failed!: ReturnType<typeof hook.result.current.handleSaveEdit>;
  act(() => { failed = hook.result.current.handleSaveEdit('Captured first words', []); });
  await tick();
  expect(writes).toBe(2);
  const captured = (engineCopy!.thoughts as unknown as Thought[]).find(value => value.id !== 'existing')!;
  const { awaitWriteOperation } = await import('@/utils/recoverableWrite');
  await act(async () => {
    failedStructure.reject(new Error('Follow-up capture refused'));
    await expect(awaitWriteOperation(failed, () => undefined)).rejects.toThrow('Follow-up capture refused');
  });
  await act(async () => {
    await awaitWriteOperation(hook.result.current.handleSaveEdit('Corrected after partial capture', []), () => undefined);
  });
  const thoughts = engineCopy!.thoughts as unknown as Thought[];
  expect(thoughts).toHaveLength(2);
  expect(thoughts.find(value => value.id === captured.id)).toMatchObject({ text: 'Corrected after partial capture', date: captured.date });
});


it('bases repeated creation retries on the last captured text rather than a stale same-ID board row', async () => {
  let engineCopy: DocumentData | null = initial as unknown as DocumentData;
  let shown = initial;
  let writes = 0;
  const writer = createEngineStructureWriter({ update: change => {
    engineCopy = change(engineCopy);
    writes++;
    return writes === 2 || writes === 4 ? Promise.reject(new Error('Structure capture refused')) : Promise.resolve();
  } }, 'owner');
  const hook = renderHook(() => useSermonActions({ sermon: shown, setSermon: jest.fn(),
    containers: { main: [item] }, containersRef: { current: { main: [item] } }, setContainers: jest.fn(),
    allowedTags: [], debouncedSaveThought: jest.fn(), debouncedSaveStructure: jest.fn(),
  }), { wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> });
  const { awaitWriteOperation } = await import('@/utils/recoverableWrite');
  act(() => hook.result.current.handleAddThoughtToSection('main'));
  await act(async () => {
    await expect(awaitWriteOperation(hook.result.current.handleSaveEdit('Version A', []), () => undefined)).rejects.toThrow('Structure capture refused');
  });
  shown = { ...engineCopy, id: 'sermon' } as unknown as Sermon;
  hook.rerender();
  await act(async () => {
    await expect(awaitWriteOperation(hook.result.current.handleSaveEdit('Version B', []), () => undefined)).rejects.toThrow('Structure capture refused');
  });
  expect((engineCopy!.thoughts as unknown as Thought[]).some(value => value.text === 'Version B')).toBe(true);
  await act(async () => {
    await awaitWriteOperation(hook.result.current.handleSaveEdit('Version A', []), () => undefined);
  });
  const thoughts = engineCopy!.thoughts as unknown as Thought[];
  expect(thoughts).toHaveLength(2);
  expect(thoughts.filter(value => value.id !== 'existing').map(value => value.text)).toEqual(['Version A']);
});
