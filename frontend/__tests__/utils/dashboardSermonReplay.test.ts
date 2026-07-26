import { QueryClient } from '@tanstack/react-query';

import { updateSermon } from '@/services/sermon.service';
import {
  DASHBOARD_SERMON_MUTATION_KEYS,
  registerOfflineMutationDefaults,
} from '@/utils/mutationDefaults';

/**
 * The dashboard sermon writer is a PERSISTED mutation: it survives a reload and
 * replays later, carrying the sermon object as it looked when the person clicked.
 *
 * Adversarial review found it sending that whole stale snapshot — verse,
 * isPreached and the entire preparation map — with no stated revision. Replaying
 * a queued title edit therefore erased whatever another device had written in the
 * meantime, silently. These tests pin the two properties that stop it: write only
 * the touched fields, and say which revision the edit was built from.
 */
jest.mock('@/services/sermon.service', () => ({
  createSermon: jest.fn(),
  deleteSermon: jest.fn(),
  updateSermon: jest.fn().mockResolvedValue({ id: 's1', title: 'New title' }),
}));

jest.mock('@/services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
  deletePreachDate: jest.fn(),
}));

const mockUpdateSermon = updateSermon as jest.MockedFunction<typeof updateSermon>;

const staleSermon = {
  id: 's1',
  title: 'Old title',
  verse: 'Verse as it was yesterday',
  date: '2026-07-20',
  userId: 'u1',
  thoughts: [],
  outline: { introduction: [], main: [], conclusion: [] },
  isPreached: false,
  preparation: { step1: { text: 'written on the phone' } },
  rev: { core: 4 },
} as never;

const runUpdate = async (queryClient: QueryClient) => {
  const fn = queryClient.getMutationDefaults(DASHBOARD_SERMON_MUTATION_KEYS.update)
    ?.mutationFn as (vars: unknown) => Promise<unknown>;
  await fn({
    sermonId: 's1',
    uid: 'u1',
    newPlannedDateId: 'pd-1',
    input: {
      sermon: staleSermon,
      title: 'New title',
      verse: 'Verse as it was yesterday',
      plannedDate: undefined,
      initialPlannedDate: undefined,
    },
  });
};

describe('the persisted dashboard sermon edit', () => {
  beforeEach(() => {
    mockUpdateSermon.mockClear();
    mockUpdateSermon.mockResolvedValue({ id: 's1', title: 'New title' } as never);
  });

  it('writes ONLY the fields the person touched', async () => {
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);

    await runUpdate(queryClient);

    const [, patch] = mockUpdateSermon.mock.calls[0];
    expect(patch).toEqual({ title: 'New title', verse: 'Verse as it was yesterday' });
    // THE POINT: no preparation, no isPreached — a replay cannot revert them.
    expect(patch).not.toHaveProperty('preparation');
    expect(patch).not.toHaveProperty('isPreached');
  });

  it('states the revision it was built from, so a stale replay is refused', async () => {
    const queryClient = new QueryClient();
    registerOfflineMutationDefaults(queryClient);

    await runUpdate(queryClient);

    const [, , expectedRevision] = mockUpdateSermon.mock.calls[0];
    expect(expectedRevision).toBe(4);
  });
});
