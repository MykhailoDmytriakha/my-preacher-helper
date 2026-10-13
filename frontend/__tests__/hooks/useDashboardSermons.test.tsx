import { renderHook } from '@testing-library/react';

import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { useSermonsDataCollection } from '@/hooks/useSermonsDataCollection';

import type { Sermon } from '@/models/models';

/**
 * THE DASHBOARD'S SERMONS come from the data engine's rows (sermons are engine-owned): the list,
 * its loading and error state, and a refresh that asks the engine again.
 */

jest.mock('@/hooks/useSermonsDataCollection', () => ({ useSermonsDataCollection: jest.fn() }));
jest.mock('@/hooks/useServerFirstQuery', () => ({ useServerFirstQuery: () => ({ data: [], isLoading: false, error: null, refetch: jest.fn() }) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'user-1' } } }));

const sermon = (id: string): Sermon => ({ id, title: `Sermon ${id}`, verse: 'John 3:16', date: '2024-01-01', thoughts: [], userId: 'user-1' });

describe('useDashboardSermons', () => {
  it('returns the engine rows and refreshes the engine', async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useSermonsDataCollection).mockReturnValue({
      sermons: [sermon('1'), sermon('2')], loading: false, error: null, refresh, state: undefined, complete: true,
    } as unknown as ReturnType<typeof useSermonsDataCollection>);

    const { result } = renderHook(() => useDashboardSermons());

    expect(result.current.sermons.map(entry => entry.id)).toEqual(['1', '2']);
    expect(result.current.loading).toBe(false);
    await result.current.refresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('passes the engine read error through', () => {
    jest.mocked(useSermonsDataCollection).mockReturnValue({
      sermons: [], loading: false, error: 'network', refresh: jest.fn(), state: undefined, complete: false,
    } as unknown as ReturnType<typeof useSermonsDataCollection>);

    const { result } = renderHook(() => useDashboardSermons());

    expect(result.current.error).toBe('network');
  });
});
