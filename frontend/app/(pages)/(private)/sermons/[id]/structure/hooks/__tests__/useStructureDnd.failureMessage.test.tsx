import { act, renderHook } from '@testing-library/react';
import { createInstance } from 'i18next';
import React from 'react';
import { toast } from 'sonner';

import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import type { Item, Sermon } from '@/models/models';
import { OfflineQueuedError } from '@/services/conflictSafeUpdate.client';
import { awaitWriteOperation } from '@/utils/recoverableWrite';
import en from '@locales/en/translation.json';

import { useStructureDnd } from '../useStructureDnd';

jest.unmock('i18next');
const mockTranslate = jest.fn();
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('sonner', () => ({ toast: { error: jest.fn() } }));

const expectedFailure = 'Could not save the move immediately.';
const makeStand = (preview: boolean, failure?: Error) => {
  const items: Item[] = ['first', 'second'].map((id, index) => ({
    id, content: `Words for ${id}`, requiredTags: [], customTagNames: [],
    outlinePointId: null, subPointId: null, position: (index + 1) * 1000,
  }));
  const containers: Record<string, Item[]> = { introduction: items, main: [], conclusion: [], ambiguous: [] };
  const sermon = {
    id: 'sermon', userId: 'owner', title: 'Sermon', verse: '', date: '2026-10-19',
    thoughts: items.map(item => ({ id: item.id, text: item.content, tags: [], date: '2026-10-19', position: item.position })),
    structure: { introduction: ['first', 'second'], main: [], conclusion: [], ambiguous: [] },
  } as Sermon;
  const writer: StructureWriter = {
    updateStructure: jest.fn(() => failure ? Promise.reject(failure) : Promise.resolve(undefined)),
    updateThought: jest.fn(async (_id, thought) => thought),
    deleteThought: jest.fn(), createManualThought: jest.fn(), updateSermonOutline: jest.fn(),
  };
  const containersRef = { current: containers };
  const hook = renderHook(() => useStructureDnd({
    containers, containersRef, sermon, setContainers: jest.fn(), setSermon: jest.fn(),
  }), { wrapper: ({ children }) => React.createElement(StructureWriterContext.Provider, { value: writer }, children) });
  act(() => { hook.result.current.handleDragStart({ active: { id: 'second' } } as never); });
  if (preview) containersRef.current = { ...containers, introduction: [{ ...items[1], position: 500 }, items[0]] };
  const over = preview ? { id: 'second', data: { current: { container: 'introduction', outlinePointId: null } } }
    : { id: 'main', data: { current: { container: 'main' } } };
  const drop = () => awaitWriteOperation(hook.result.current.handleDragEnd({ active: { id: 'second' }, over } as never), () => undefined);
  return { drop, writer };
};

beforeEach(() => { jest.clearAllMocks(); });

it.each([
  ['normal', false, 'en'], ['preview', true, 'en'],
  ['normal default', false, 'missing'], ['preview default', true, 'missing'],
] as const)('reports %s refusal without promising a rollback', async (_name, preview, language) => {
  const i18n = createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  mockTranslate.mockImplementation((key, options) => i18n.t(key, options));
  const failure = new Error('Device capture refused');
  const stand = makeStand(preview, failure);
  await act(async () => { await expect(stand.drop()).rejects.toBe(failure); });
  expect(stand.writer.updateStructure).toHaveBeenCalledTimes(1);
  expect(stand.writer.updateThought).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(toast.error).toHaveBeenCalledWith(expectedFailure);
});

it.each([['accepted', undefined], ['offline queued', new OfflineQueuedError('structure')]] as const)(
  'keeps an %s move silent', async (_name, failure) => {
    mockTranslate.mockImplementation(key => key);
    const stand = makeStand(false, failure);
    await act(async () => { await stand.drop(); });
    expect(stand.writer.updateStructure).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  },
);
