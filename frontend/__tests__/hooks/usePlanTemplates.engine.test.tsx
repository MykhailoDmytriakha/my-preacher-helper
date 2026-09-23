import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { createPlanTemplate, deletePlanTemplate, updatePlanTemplate } from '@/services/planTemplate.service';

jest.mock('@/services/planTemplate.service', () => ({ getPlanTemplates: jest.fn(), createPlanTemplate: jest.fn(), updatePlanTemplate: jest.fn(), deletePlanTemplate: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  isCollectionOnEngine: (collection: string) => collection === 'planTemplates',
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));

const outline = { introduction: [], main: [{ id: 'p1', text: 'One' }], conclusion: [] };
const stored = { userId: 'u', name: 'Advent', structure: outline, rev: { template: 3 }, createdAt: 'c', updatedAt: 'u' };
let current: Record<string, unknown> = stored;
const actions = {
  ready: true,
  create: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn(async (_resource: unknown, updater: (value: Record<string, unknown>) => Record<string, unknown>) => { current = updater(current); }),
};

function render() {
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockReturnValue({ state: { snapshots: [], documents: [
    { resource: { collection: 'planTemplates', id: 'tpl' }, value: stored },
  ], complete: true, freshness: 'server', checking: false, version: 1, error: null }, loading: false, error: null, refresh: jest.fn() } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(() => usePlanTemplates('u'), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe('plan templates on the engine', () => {
  beforeEach(() => { jest.clearAllMocks(); current = stored; });

  it('lists, creates, renames at the current revision and deletes through engine actions only', async () => {
    const { result } = render();
    expect(result.current.templates).toEqual([expect.objectContaining({ id: 'tpl', name: 'Advent' })]);
    await act(async () => { await result.current.createTemplate({ id: 'new', userId: 'u', name: 'Lent', structure: outline }).persistence; });
    expect(actions.create).toHaveBeenCalledWith({ collection: 'planTemplates', id: 'new' }, expect.objectContaining({ userId: 'u', name: 'Lent' }));
    await act(async () => { await result.current.updateTemplate('tpl', { name: 'Advent 2026' }, 3).persistence; });
    expect(current).toEqual(expect.objectContaining({ name: 'Advent 2026' }));
    await act(async () => { await result.current.deleteTemplate('tpl').persistence; });
    expect(actions.remove).toHaveBeenCalledWith({ collection: 'planTemplates', id: 'tpl' });
    expect(createPlanTemplate).not.toHaveBeenCalled(); expect(updatePlanTemplate).not.toHaveBeenCalled(); expect(deletePlanTemplate).not.toHaveBeenCalled();
  });

  it('refuses an edit built from an older revision with the revision the template holds now', async () => {
    const { result } = render();
    const error = await result.current.updateTemplate('tpl', { name: 'From a stale tab' }, 2).persistence.catch(e => e);
    expect(isStaleWriteError(error)).toBe(true);
    expect(error.actualRevision).toBe(3);
    expect(current).toEqual(stored);
  });
});
