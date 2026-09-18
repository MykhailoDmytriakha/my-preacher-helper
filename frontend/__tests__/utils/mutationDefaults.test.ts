import { QueryClient } from '@tanstack/react-query';

import { OfflineQueuedError } from '@/services/conflictSafeUpdate.client';
import { createGroup, deleteGroup, updateGroup } from '@/services/groups.service';
import { addPreachDate, updatePreachDate } from '@/services/preachDates.service';
import { updateSermon } from '@/services/sermon.service';
import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  GROUP_MUTATION_KEYS,
  registerOfflineMutationDefaults,
} from '@/utils/mutationDefaults';

jest.mock('@/services/groups.service', () => ({
  createGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
  updateGroup: jest.fn().mockResolvedValue({ id: 'g1' }),
  deleteGroup: jest.fn().mockResolvedValue(undefined),
}));

// Partial mocks only: a blanket mock of these modules breaks the moment someone adds an
// export to them, and it breaks far from where it was written.
jest.mock('@/services/sermon.service', () => ({
  ...jest.requireActual('@/services/sermon.service'),
  updateSermon: jest.fn(),
}));
jest.mock('@/services/preachDates.service', () => ({
  ...jest.requireActual('@/services/preachDates.service'),
  addPreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
  deletePreachDate: jest.fn().mockResolvedValue(undefined),
}));

const mockCreateGroup = createGroup as jest.MockedFunction<typeof createGroup>;
const mockUpdateGroup = updateGroup as jest.MockedFunction<typeof updateGroup>;
const mockDeleteGroup = deleteGroup as jest.MockedFunction<typeof deleteGroup>;
const mockUpdateSermon = updateSermon as jest.MockedFunction<typeof updateSermon>;
const mockAddPreachDate = addPreachDate as jest.MockedFunction<typeof addPreachDate>;
const mockUpdatePreachDate = updatePreachDate as jest.MockedFunction<typeof updatePreachDate>;

describe('registerOfflineMutationDefaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers a resumable mutationFn for each group write key', () => {
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);

    expect(typeof queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.create)?.mutationFn).toBe('function');
    expect(typeof queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.update)?.mutationFn).toBe('function');
    expect(typeof queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.delete)?.mutationFn).toBe('function');
  });

  it('routes each registered mutationFn to its service call (replay path after reload)', async () => {
    // After a page reload a paused mutation rehydrated from IndexedDB carries only
    // its mutationKey + variables — the original useMutation closure is gone. The
    // registered default is what `resumePausedMutations()` actually invokes. This
    // asserts that link is wired correctly for every group write.
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);

    const createFn = queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.create)?.mutationFn as (
      v: unknown
    ) => Promise<unknown>;
    const updateFn = queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.update)?.mutationFn as (
      v: unknown
    ) => Promise<unknown>;
    const deleteFn = queryClient.getMutationDefaults(GROUP_MUTATION_KEYS.delete)?.mutationFn as (
      v: unknown
    ) => Promise<unknown>;

    await createFn({ userId: 'u', title: 'T' });
    await updateFn({ id: 'g1', updates: { title: 'X' } });
    await deleteFn('g1');

    expect(mockCreateGroup).toHaveBeenCalledWith({ userId: 'u', title: 'T' });
    expect(mockUpdateGroup).toHaveBeenCalledWith('g1', { title: 'X' });
    expect(mockDeleteGroup).toHaveBeenCalledWith('g1');
  });

  describe('the congregation a sermon is prepared for', () => {
    const NAMED = { id: 'c-grace', name: 'Grace Chapel', city: 'Fresno' };
    const STAND_IN = { id: 'church-unspecified', name: 'Church not specified', city: '' };

    const runEdit = async (input: Record<string, unknown>) => {
      const queryClient = new QueryClient();
      registerOfflineMutationDefaults(queryClient);
      const updateFn = queryClient.getMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.update)
        ?.mutationFn as (v: unknown) => Promise<unknown>;
      return updateFn({ uid: 'u1', sermonId: 's1', newPlannedDateId: 'pd-new', input });
    };

    beforeEach(() => {
      mockUpdateSermon.mockResolvedValue({ id: 's1', title: 'T', verse: 'V' } as never);
      mockAddPreachDate.mockImplementation(async (_sermonId, draft) => ({ ...draft, id: 'pd-new' }) as never);
      mockUpdatePreachDate.mockImplementation(async (_sermonId, dateId, updates) => ({ id: dateId, ...updates }) as never);
    });

    it('sends the church to the sermon document', async () => {
      await runEdit({
        sermon: { id: 's1', title: 'T', verse: 'V', preachDates: [] },
        title: 'T', verse: 'V', plannedDate: '', initialPlannedDate: '', church: NAMED,
      });

      expect(mockUpdateSermon).toHaveBeenCalledWith(
        expect.objectContaining({ church: NAMED }),
        expect.objectContaining({ church: NAMED }),
        expect.anything()
      );
    });

    it('is kept even when NO date was given — a congregation is known long before a date', async () => {
      await runEdit({
        sermon: { id: 's1', title: 'T', verse: 'V', preachDates: [] },
        title: 'T', verse: 'V', plannedDate: '', initialPlannedDate: '', church: NAMED,
      });

      expect(mockUpdateSermon).toHaveBeenCalledTimes(1);
      expect(mockAddPreachDate).not.toHaveBeenCalled();
    });

    it('gives a BRAND NEW planned date the church named in the same form', async () => {
      await runEdit({
        sermon: { id: 's1', title: 'T', verse: 'V', preachDates: [] },
        title: 'T', verse: 'V', plannedDate: '2026-09-20', initialPlannedDate: '', church: NAMED,
      });

      expect(mockAddPreachDate).toHaveBeenCalledWith('s1', expect.objectContaining({ church: NAMED }));
    });

    it('fills an EXISTING planned date that still holds the stand-in, even when the date itself did not change', async () => {
      await runEdit({
        sermon: {
          id: 's1', title: 'T', verse: 'V',
          preachDates: [{ id: 'pd-1', date: '2026-09-20', status: 'planned', church: STAND_IN }],
        },
        title: 'T', verse: 'V', plannedDate: '2026-09-20', initialPlannedDate: '2026-09-20', church: NAMED,
      });

      expect(mockUpdatePreachDate).toHaveBeenCalledWith('s1', 'pd-1', { church: NAMED });
    });

    it('NEVER overwrites a planned date that already names its own congregation', async () => {
      const OTHER = { id: 'c-other', name: 'Hope Church', city: '' };
      await runEdit({
        sermon: {
          id: 's1', title: 'T', verse: 'V',
          preachDates: [{ id: 'pd-1', date: '2026-09-20', status: 'planned', church: OTHER }],
        },
        title: 'T', verse: 'V', plannedDate: '2026-09-20', initialPlannedDate: '2026-09-20', church: NAMED,
      });

      expect(mockUpdatePreachDate).not.toHaveBeenCalled();
    });
  });

  it('does NOT roll the sermon row back when the write was QUEUED, not refused', async () => {
    /**
     * Nominally online, Firestore unreachable: `conflictSafeUpdate` stores the edit in the
     * durable outbox and throws `OfflineQueuedError`. That is a receipt. Rolling back here
     * took the person's edit off the screen while it sat safely waiting to replay — the
     * screen contradicting what was actually kept.
     */
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);
    const setQueryData = jest.spyOn(queryClient, 'setQueryData');

    const onError = queryClient.getMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.update)
      ?.onError as (error: unknown, vars: unknown, ctx: unknown) => Promise<void>;

    await onError(
      new OfflineQueuedError('core'),
      { uid: 'user-1', sermonId: 's1', input: { sermon: { id: 's1', title: 'old' } } },
      undefined
    );

    expect(setQueryData).not.toHaveBeenCalled();
  });
});
