import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { createEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import { InactiveEditorError } from '@/data-engine/controller';

import { useColumnOutlineState } from '../useColumnOutlineState';

import type { DocumentData } from '@/data-engine/types';
import type { SermonOutline, SermonPoint } from '@/models/models';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/services/outline.service', () => ({ generateSermonPointsForSection: jest.fn() }));
const t = (key: string) => key;
const points: SermonPoint[] = [{ id: 'first', text: 'First point' }, { id: 'second', text: 'Second point' }];
const outline = (main = points): SermonOutline => ({ introduction: [], main, conclusion: [] });
const mount = (writer: StructureWriter, onOutlineUpdate = jest.fn()) => renderHook(
  ({ shown }: { shown: SermonPoint[] }) => useColumnOutlineState({ id: 'main', sermonId: 'sermon-1', initialSermonPoints: shown, onOutlineUpdate, t }),
  { initialProps: { shown: points }, wrapper: ({ children }) => <StructureWriterContext.Provider value={writer}>{children}</StructureWriterContext.Provider> },
);
const documentModel = () => {
  const state = { value: { userId: 'owner', title: 'Column lifecycle', thoughts: [], outline: outline() } as unknown as DocumentData };
  const writer = createEngineStructureWriter({ update: async updater => { state.value = updater(state.value)!; } }, 'owner');
  return { state, writer };
};
const currentOutline = (value: DocumentData) => value.outline as unknown as SermonOutline;

beforeEach(() => { jest.clearAllMocks(); });

it('keeps an ordinary edited point and its sibling', async () => {
  const { state, writer } = documentModel();
  const view = mount(writer);
  await act(async () => { view.result.current.handleSaveEditDirect('first', 'Ordinary words'); });
  expect(currentOutline(state.value).main).toEqual([{ id: 'first', text: 'Ordinary words' }, points[1]]);
  expect(view.result.current.localSermonPoints).toEqual(currentOutline(state.value).main);
});

it('still reports a genuine failed capture and keeps the typed visible words', async () => {
  const { writer } = documentModel();
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = mount({ ...writer, updateSermonOutline: async () => { throw new Error('Device write refused'); } });
    await act(async () => { view.result.current.handleSaveEditDirect('first', 'Words before failure'); });
    expect(view.result.current.localSermonPoints[0].text).toBe('Words before failure');
    expect(toast.error).toHaveBeenCalledTimes(1);
  } finally { error.mockRestore(); }
});

it('keeps a newer adopted parent list when an earlier completed save returns', async () => {
  const { state, writer } = documentModel();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const delayed: StructureWriter = { ...writer, updateSermonOutline: async (...args) => {
    const captured = await writer.updateSermonOutline(...args);
    await held;
    return captured;
  } };
  const view = mount(delayed);
  await act(async () => { view.result.current.handleSaveEditDirect('first', 'First accepted words'); });
  const newer = currentOutline(state.value).main.map(point => point.id === 'second' ? { ...point, text: 'Later device words' } : point);
  state.value = { ...state.value, outline: outline(newer) } as unknown as DocumentData;
  view.rerender({ shown: newer });
  expect(view.result.current.localSermonPoints).toEqual(newer);
  await act(async () => { release(); });
  expect(view.result.current.localSermonPoints).toEqual(newer);
  expect(currentOutline(state.value).main).toEqual(newer);
});

it.each([false, true])('keeps an explicit reversal after failed checkpoint capture, parent refreshed: %s', async refreshed => {
  let fail = true;
  const state = { value: { userId: 'owner', title: 'Column lifecycle', thoughts: [], outline: outline() } as unknown as DocumentData };
  const writer = createEngineStructureWriter({ update: async updater => {
    state.value = updater(state.value)!;
    if (fail) { fail = false; throw new Error('Checkpoint write refused after applying the updater'); }
  } }, 'owner');
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = mount(writer);
    await act(async () => { view.result.current.handleSaveEditDirect('first', 'Intermediate words'); });
    expect(currentOutline(state.value).main[0].text).toBe('Intermediate words');
    if (refreshed) view.rerender({ shown: currentOutline(state.value).main });
    await act(async () => { view.result.current.handleSaveEditDirect('first', 'First point'); });
    expect(currentOutline(state.value).main).toEqual(points);
    expect(view.result.current.localSermonPoints).toEqual(points);
  } finally { error.mockRestore(); }
});

it.each([true, false])('treats a retired editor answer as cancellation only after departure: %s', async departed => {
  const { writer } = documentModel();
  let fail!: (error: Error) => void;
  const delayed = { ...writer, updateSermonOutline: () => new Promise<SermonOutline | null>((_resolve, reject) => { fail = reject; }) };
  const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = mount(delayed);
    act(() => { view.result.current.handleSaveEditDirect('first', 'Words before leaving'); });
    if (departed) view.unmount();
    await act(async () => { fail(new InactiveEditorError()); });
    expect(toast.error).toHaveBeenCalledTimes(departed ? 0 : 1);
  } finally { error.mockRestore(); }
});

it('keeps a queued point deletion while a later remaining point is edited before parent adoption', async () => {
  const { state, writer } = documentModel();
  const release: Array<() => void> = [];
  const delayed: StructureWriter = { ...writer, updateSermonOutline: async (...args) => {
    const captured = await writer.updateSermonOutline(...args);
    await new Promise<void>(resolve => { release.push(resolve); });
    return captured;
  } };
  const view = mount(delayed);
  act(() => { view.result.current.setDeletePointId('first'); });
  await act(async () => { view.result.current.confirmDeletePoint(); });
  await act(async () => { view.result.current.handleSaveEditDirect('second', 'Remaining latest words'); });
  expect(currentOutline(state.value).main).toEqual([{ id: 'second', text: 'Remaining latest words' }]);
  await act(async () => { release.forEach(resolve => resolve()); });
  expect(view.result.current.localSermonPoints).toEqual([{ id: 'second', text: 'Remaining latest words' }]);
});


it.each([false, true])('still reports a genuine device failure after departure, cancellation-like name: %s', async namedLikeCancellation => {
  const { writer } = documentModel();
  let fail!: (error: Error) => void;
  const delayed = { ...writer, updateSermonOutline: () => new Promise<SermonOutline | null>((_resolve, reject) => { fail = reject; }) };
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const view = mount(delayed);
    act(() => { view.result.current.handleSaveEditDirect('first', 'Words before a real device failure'); });
    view.unmount();
    const failure = new Error('Device write refused');
    if (namedLikeCancellation) failure.name = 'InactiveEditorError';
    await act(async () => { fail(failure); });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith('Error saving sermon outline:', failure);
  } finally { errorLog.mockRestore(); }
});
