import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useTags } from '@/hooks/useTags';
import { awaitWriteOperation } from '@/utils/recoverableWrite';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const row = (id: string, value: Record<string, unknown> | null) => ({ resource: { collection: 'tags', id }, value });
const actions = { ready: true, submit: jest.fn(), create: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined), commit: jest.fn().mockResolvedValue(undefined), resolve: jest.fn().mockResolvedValue(0) };

function render() {
  jest.mocked(useDocumentActions).mockReturnValue(actions);
  jest.mocked(useDataCollection).mockReturnValue({ state: { snapshots: [], documents: [
    row('t1', { userId: 'u', name: 'Hope', color: '#111', required: false }),
    row('intro', { userId: 'u', name: 'intro', color: '#222', required: false }),
    row('gone', null),
  ], complete: true, freshness: 'server', checking: false, version: 1, error: null }, loading: false, error: null, refresh: jest.fn() } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useTags('u'), { wrapper });
}

describe('custom tags on the engine', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists custom tags from the engine collection, without structure names or deleted rows', () => {
    const { result } = render();
    expect(result.current.customTags).toEqual([expect.objectContaining({ id: 't1', name: 'Hope' })]);
    expect(useDataCollection).toHaveBeenCalledWith('tags');
  });

  it('creates, recolors and removes through engine actions', async () => {
    const { result } = render();
    await act(async () => { await awaitWriteOperation(result.current.addCustomTag({ id: 'new', userId: 'u', name: 'Faith', color: '#333', required: false }), jest.fn()); });
    expect(actions.create).toHaveBeenCalledWith({ collection: 'tags', id: 'new' }, expect.objectContaining({ userId: 'u', name: 'Faith', color: '#333', required: false }));
    await act(async () => { await awaitWriteOperation(result.current.updateTag({ id: 't1', userId: 'u', name: 'Hope', color: '#444', required: false }), jest.fn()); });
    const recolor = actions.commit.mock.calls[0][1] as (current: Record<string, unknown>) => Record<string, unknown>;
    expect(recolor({ userId: 'u', name: 'Hope', color: '#111', required: false })).toEqual(expect.objectContaining({ color: '#444', required: false }));
    await act(async () => { await awaitWriteOperation(result.current.removeCustomTag('Hope'), jest.fn()); });
    expect(actions.remove).toHaveBeenCalledWith({ collection: 'tags', id: 't1' });
  });

  it.each(['recolor', 'remove'] as const)('waits for actual local capture when %s is pending', async (kind) => {
    jest.useFakeTimers();
    let finish!: () => void;
    const capture = new Promise<void>((resolve) => { finish = resolve; });
    const { result } = render();
    (kind === 'recolor' ? actions.commit : actions.remove).mockReturnValueOnce(capture);
    const operation = kind === 'recolor'
      ? result.current.updateTag({ id: 't1', userId: 'u', name: 'Hope', color: '#444', required: false })
      : result.current.removeCustomTag('Hope');
    let accepted = false;
    const waiting = awaitWriteOperation(operation, jest.fn()).then(() => { accepted = true; });
    try {
      await act(async () => { jest.advanceTimersByTime(50); });
      expect(accepted).toBe(false);
      finish();
      await act(async () => { await waiting; });
      expect(accepted).toBe(true);
    } finally {
      finish();
      await act(async () => { await waiting; });
      jest.useRealTimers();
    }
  });

  it('refuses a duplicate or reserved name before any engine write', async () => {
    const { result } = render();
    await expect(awaitWriteOperation(result.current.addCustomTag({ id: 'x', userId: 'u', name: 'Hope', color: '#1', required: false }), jest.fn())).rejects.toThrow('already exists');
    await expect(awaitWriteOperation(result.current.addCustomTag({ id: 'y', userId: 'u', name: 'intro', color: '#1', required: false }), jest.fn())).rejects.toThrow('Reserved');
    expect(actions.create).not.toHaveBeenCalled();
  });
});
