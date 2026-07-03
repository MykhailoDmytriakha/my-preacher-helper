import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useGroupDetail } from '@/hooks/useGroupDetail';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';

import type { Group } from '@/models/models';
import type { ReactNode } from 'react';

// This suite exercises the REAL groups.service (client-SDK own-doc RMW) with the
// REAL Firestore `updateDoc` HUNG (never resolves), the way an offline write
// behaves before it drains from Firestore's native queue. It proves that the
// hook's fire-and-forget wrappers do NOT block and that BOTH the content patch
// and the meeting-date patch land in the optimistic caches (guards 1c/1a).

const mockGetClientDb = jest.fn(() => ({ app: 'client-db' }));
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn();

jest.mock('@/config/firebaseClientDb', () => ({
  getClientDb: () => mockGetClientDb(),
}));

jest.mock('firebase/firestore', () => ({
  addDoc: jest.fn(),
  arrayUnion: jest.fn((v: unknown) => v),
  collection: jest.fn((_db: unknown, path: string) => ({ path })),
  doc: (_db: unknown, path: string, id: string) => mockDoc(_db, path, id),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: jest.fn(),
  query: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  where: jest.fn(),
}));

jest.mock('@/hooks/useServerFirstQuery', () => ({
  useServerFirstQuery: jest.fn(),
}));

jest.mock('@/hooks/useResolvedUid', () => ({
  useResolvedUid: () => ({ uid: 'user-1', isAuthLoading: false }),
}));

// Offline: the fire-and-forget `.catch` must NOT toast on the offline getDoc-miss
// edge, so we assert no toast fired below.
jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => false,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const mockUseServerFirstQuery = useServerFirstQuery as jest.MockedFunction<typeof useServerFirstQuery>;

const baseGroup: Group = {
  id: 'g1',
  userId: 'user-1',
  title: 'Group 1',
  status: 'draft',
  templates: [],
  flow: [],
  meetingDates: [],
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-10T00:00:00.000Z',
};

const docSnap = (data: Group) => ({
  id: data.id,
  exists: () => true,
  data: () => data,
});

describe('useGroupDetail (offline / hung updateDoc)', () => {
  it('does not hang and applies BOTH optimistic patches for a combined content+meeting edit', async () => {
    // The group doc always reads back (Firestore replica), but the write hangs.
    mockGetDoc.mockResolvedValue(docSnap(baseGroup));
    mockUpdateDoc.mockImplementation(() => new Promise(() => {})); // never resolves

    mockUseServerFirstQuery.mockReturnValue({
      data: baseGroup,
      isLoading: false,
      isFetching: false,
      error: null,
      refetch: jest.fn().mockResolvedValue(undefined),
    } as any);

    // Seed the caches the optimistic updaters patch (guarded updaters are no-ops
    // against an empty cache — mirrors the loaded detail/list on a real page).
    const queryClient = new QueryClient({
      // gcTime: Infinity — the seeded caches have no active observer (useServerFirstQuery
      // is mocked), so gcTime: 0 would schedule an immediate GC that races the optimistic
      // setQueryData updaters and makes this test a load-dependent flake.
      defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 }, mutations: { retry: false } },
    });
    queryClient.setQueryData(['group-detail', 'g1'], baseGroup);
    queryClient.setQueryData(['groups', 'user-1'], [baseGroup]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useGroupDetail('g1'), { wrapper });

    // If the wrappers awaited the hung write, this act() would never resolve.
    await act(async () => {
      await result.current.updateGroupDetail({ title: 'Renamed' });
      await result.current.addMeetingDate({ date: '2026-03-01', location: 'Hall' });
    });

    const detail = queryClient.getQueryData<Group>(['group-detail', 'g1']);
    expect(detail?.title).toBe('Renamed'); // content patch survived
    expect(detail?.meetingDates).toEqual([
      expect.objectContaining({ date: '2026-03-01', location: 'Hall' }),
    ]); // meeting patch composed on top of the content patch

    const list = queryClient.getQueryData<Group[]>(['groups', 'user-1']);
    expect(list?.[0]?.title).toBe('Renamed');
    expect(list?.[0]?.meetingDates).toEqual([
      expect.objectContaining({ date: '2026-03-01', location: 'Hall' }),
    ]);

    // The write really was attempted (and is still pending / hung) once the
    // getDoc read of the RMW resolves.
    await waitFor(() => expect(mockUpdateDoc).toHaveBeenCalled());
  });
});
