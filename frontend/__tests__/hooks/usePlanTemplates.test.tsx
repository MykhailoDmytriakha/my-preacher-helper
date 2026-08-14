import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { usePlanTemplates } from '@/hooks/usePlanTemplates';
import { OfflineQueuedError, StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { getPlanTemplates, updatePlanTemplate } from '@/services/planTemplate.service';

import type { PlanTemplate } from '@/models/models';

jest.mock('@/services/planTemplate.service', () => ({
  getPlanTemplates: jest.fn(),
  createPlanTemplate: jest.fn(),
  updatePlanTemplate: jest.fn(),
  deletePlanTemplate: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

const mockGet = getPlanTemplates as jest.MockedFunction<typeof getPlanTemplates>;
const mockUpdate = updatePlanTemplate as jest.MockedFunction<typeof updatePlanTemplate>;

const template = (name: string): PlanTemplate =>
  ({ id: 't1', userId: 'user-1', name, structure: {} }) as unknown as PlanTemplate;

const mount = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...renderHook(() => usePlanTemplates('user-1'), { wrapper }) };
};

const cached = (queryClient: QueryClient) =>
  queryClient.getQueryData<PlanTemplate[]>(['planTemplates', 'user-1']) ?? [];

describe('usePlanTemplates — a queued write is stored, not failed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue([template('Alpha')]);
  });

  it('keeps the renamed template on screen when the write was QUEUED', async () => {
    /**
     * Nominally online, Firestore unreachable: the rename goes to the durable outbox and
     * comes back as `OfflineQueuedError`. Rolling the optimistic name back here made the
     * person watch their accepted edit revert for no stated reason — and invited them to
     * type it again, while the outbox still held the first copy.
     */
    mockUpdate.mockRejectedValueOnce(new OfflineQueuedError('template'));
    const { result, queryClient } = mount();

    await waitFor(() => expect(cached(queryClient)).toHaveLength(1));

    await act(async () => {
      await result.current.updateTemplate('t1', { name: 'Alpha renamed' }, 0).persistence.catch(
        () => undefined
      );
    });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(cached(queryClient)[0].name).toBe('Alpha renamed');
  });

  it('DOES roll back a genuinely refused rename', async () => {
    // The rollback itself must stay: a stale refusal really did not change anything on
    // the server, so leaving the new name on screen would be the lie this whole contract
    // exists to prevent.
    mockUpdate.mockRejectedValueOnce(new StaleWriteError('template', 0, 3));
    const { result, queryClient } = mount();

    await waitFor(() => expect(cached(queryClient)).toHaveLength(1));

    await act(async () => {
      await result.current.updateTemplate('t1', { name: 'Alpha renamed' }, 0).persistence.catch(
        () => undefined
      );
    });

    await waitFor(() => expect(cached(queryClient)[0].name).toBe('Alpha'));
  });
});
