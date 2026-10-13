import { renderHook } from '@testing-library/react';

import { useCalendarSermons } from '@/hooks/useCalendarSermons';
import { useAuth } from '@/hooks/useAuth';

import type { Sermon } from '@/models/models';

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn(),
}));

// Sermons are engine-owned: the calendar reads the engine's rows.
const mockEngine = { sermons: [] as Sermon[], loading: false, error: null as string | null, refresh: jest.fn() };
jest.mock('@/hooks/useSermonsDataCollection', () => ({ useSermonsDataCollection: () => mockEngine }));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('useCalendarSermons', () => {
  const startDate = new Date('2024-01-01T00:00:00.000Z');
  const endDate = new Date('2024-01-31T00:00:00.000Z');

  it('groups sermons by date and identifies pending sermons', async () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as any);

    const sermons: Sermon[] = [
      {
        id: 'sermon-1',
        title: 'Pending',
        verse: '',
        date: '2024-01-10',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: true,
        preachDates: [],
      },
      {
        id: 'sermon-2',
        title: 'Scheduled',
        verse: '',
        date: '2024-01-15',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: true,
        preachDates: [
          {
            id: 'pd-1',
            date: '2024-01-07',
            createdAt: '2024-01-01T00:00:00Z',
            church: { id: 'church-1', name: 'First', city: 'Town' },
          },
        ],
      },
      {
        id: 'sermon-3',
        title: 'Multiple',
        verse: '',
        date: '2024-01-20',
        userId: 'user-1',
        thoughts: [],
        outline: { introduction: [], main: [], conclusion: [] },
        isPreached: false,
        preachDates: [
          {
            id: 'pd-2',
            date: '2024-01-07T00:00:00.000Z',
            createdAt: '2024-01-02T00:00:00Z',
            church: { id: 'church-2', name: 'Second', city: 'City' },
          },
          {
            id: 'pd-3',
            date: '2024-01-08',
            createdAt: '2024-01-03T00:00:00Z',
            church: { id: 'church-1', name: 'First', city: 'Town' },
          },
        ],
      },
    ];

    mockEngine.sermons = [...sermons, { ...sermons[1], id: 'foreign', userId: 'user-2' }];
    // The calendar page asks without a range (calendar/page.tsx), so a preached sermon with no
    // date still reaches the "no date yet" warning.
    const { result } = renderHook(() => useCalendarSermons());

    expect(result.current.pendingSermons).toHaveLength(1);
    expect(result.current.pendingSermons[0].id).toBe('sermon-1');

    expect(result.current.sermonsByDate['2024-01-07']).toHaveLength(2);
    expect(result.current.sermonsByDate['2024-01-08']).toHaveLength(1);
    expect(result.current.sermonsByDate['2024-01-07T00:00:00.000Z']).toBeUndefined();

    // A range keeps only sermons with a preach date inside it.
    const ranged = renderHook(() => useCalendarSermons(startDate, endDate)).result.current;
    expect(ranged.sermons.map(entry => entry.id).sort()).toEqual(['sermon-2', 'sermon-3']);
    mockEngine.sermons = [];
  });

  it('returns empty data when no user is available', () => {
    mockUseAuth.mockReturnValue({ user: null } as any);
    mockEngine.sermons = [{ id: 'sermon-x', userId: 'user-1', isPreached: true, preachDates: [] } as unknown as Sermon];

    const { result } = renderHook(() => useCalendarSermons());

    expect(result.current.sermons).toEqual([]);
    expect(result.current.pendingSermons).toEqual([]);
    mockEngine.sermons = [];
  });
});
