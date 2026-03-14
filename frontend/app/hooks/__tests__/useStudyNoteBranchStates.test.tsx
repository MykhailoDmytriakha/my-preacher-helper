import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/providers/AuthProvider';
import { auth } from '@/services/firebaseAuth.service';
import { getStudyNoteBranchStates } from '@services/studies.service';

import { useStudyNoteBranchStates } from '../useStudyNoteBranchStates';

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: jest.fn(),
}));

jest.mock('@services/studies.service', () => ({
  getStudyNotes: jest.fn(),
  createStudyNote: jest.fn(),
  updateStudyNote: jest.fn(),
  deleteStudyNote: jest.fn(),
  getStudyMaterials: jest.fn(),
  createStudyMaterial: jest.fn(),
  updateStudyMaterial: jest.fn(),
  deleteStudyMaterial: jest.fn(),
  getStudyNoteBranchStates: jest.fn(),
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseOnlineStatus = useOnlineStatus as jest.MockedFunction<typeof useOnlineStatus>;
const mockGetStudyNoteBranchStates = getStudyNoteBranchStates as jest.MockedFunction<typeof getStudyNoteBranchStates>;
const defaultAuthUser = auth.currentUser;
const mutableAuth = auth as { currentUser: unknown };

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useStudyNoteBranchStates', () => {
  afterEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mutableAuth.currentUser = defaultAuthUser;
  });

  it('keeps loading true while auth is in progress and avoids fetching', () => {
    mutableAuth.currentUser = null;
    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    });

    const { result } = renderHook(() => useStudyNoteBranchStates(), { wrapper: createWrapper() });

    expect(result.current.uid).toBeUndefined();
    expect(result.current.loading).toBe(true);
    expect(mockGetStudyNoteBranchStates).not.toHaveBeenCalled();
  });

  it('fetches branch states once authenticated user is available', async () => {
    const branchStates = [
      {
        id: 'note-1',
        noteId: 'note-1',
        userId: 'auth-uid',
        branchRecords: [],
        readFoldedBranchIds: [],
        previewFoldedBranchIds: [],
        createdAt: '2026-03-13T00:00:00.000Z',
        updatedAt: '2026-03-13T00:00:00.000Z',
      },
    ];

    mockUseOnlineStatus.mockReturnValue(true);
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-uid' } as any,
      loading: false,
      isAuthenticated: true,
    });
    mockGetStudyNoteBranchStates.mockResolvedValue(branchStates as any);

    const { result } = renderHook(() => useStudyNoteBranchStates(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetStudyNoteBranchStates).toHaveBeenCalledWith('auth-uid');
    expect(result.current.branchStates).toEqual(branchStates);
  });
});
