import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { usePrepModeAccess } from '@/hooks/usePrepModeAccess';
import { getUserSettings } from '@/services/userSettings.service';

let mockAuth: { user: { uid: string } | null; loading: boolean };
let mockOnline = true;
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockOnline }));
jest.mock('@/services/userSettings.service', () => ({ getUserSettings: jest.fn() }));

const mockGetSettings = jest.mocked(getUserSettings);
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mockAuth = { user: { uid: 'u1' }, loading: false };
  mockOnline = true;
  mockGetSettings.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(() => client.clear());

it('uses restored account settings while a background read never settles', async () => {
  client.setQueryData(['user-settings', 'u1'], { enablePrepMode: true }, { updatedAt: 1 });
  const { result } = renderHook(usePrepModeAccess, { wrapper });
  expect(result.current).toEqual({ hasAccess: true, loading: false });
  await waitFor(() => expect(mockGetSettings).toHaveBeenCalledWith('u1'));
  expect(result.current).toEqual({ hasAccess: true, loading: false });
});

it('keeps restored prep access available offline', () => {
  mockOnline = false;
  client.setQueryData(['user-settings', 'u1'], { enablePrepMode: true });
  const { result } = renderHook(usePrepModeAccess, { wrapper });
  expect(result.current).toEqual({ hasAccess: true, loading: false });
  expect(mockGetSettings).not.toHaveBeenCalled();
});

it('reacts to settings changes without a separate access fetch', async () => {
  client.setQueryData(['user-settings', 'u1'], { enablePrepMode: true });
  const { result } = renderHook(usePrepModeAccess, { wrapper });
  act(() => { client.setQueryData(['user-settings', 'u1'], { enablePrepMode: false }); });
  await waitFor(() => expect(result.current.hasAccess).toBe(false));
});

it('does not reuse the previous account access on account switch', () => {
  client.setQueryData(['user-settings', 'u1'], { enablePrepMode: true });
  const { result, rerender } = renderHook(usePrepModeAccess, { wrapper });
  mockAuth = { user: { uid: 'u2' }, loading: false };
  rerender();
  expect(result.current).toEqual({ hasAccess: false, loading: true });
});

it('waits for authentication and preserves the existing guest policy', () => {
  mockAuth = { user: null, loading: true };
  const { result, rerender } = renderHook(usePrepModeAccess, { wrapper });
  expect(result.current).toEqual({ hasAccess: false, loading: true });
  mockAuth = { user: null, loading: false };
  rerender();
  expect(result.current).toEqual({ hasAccess: true, loading: false });
});
