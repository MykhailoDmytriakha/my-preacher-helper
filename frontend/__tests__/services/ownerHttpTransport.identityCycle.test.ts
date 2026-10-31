import { waitFor } from '@testing-library/react';

import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

type BrowserUser = { uid: string; getIdToken: jest.Mock<Promise<string>> };
let mockSelected: BrowserUser;
let mockHeaderReads = 0;
jest.mock('@/services/firebaseAuth.service', () => ({ auth: {
  get currentUser() { mockHeaderReads += 1; return mockSelected; },
} }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: () => mockSelected?.uid }));
jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));

it('does not send B credentials for A after identity changes A to B and back during header acquisition', async () => {
  jest.clearAllMocks(); mockHeaderReads = 0;
  const a: BrowserUser = { uid: 'A', getIdToken: jest.fn().mockResolvedValue('token-A') };
  let finishB: ((token: string) => void) | undefined;
  const b: BrowserUser = { uid: 'B', getIdToken: jest.fn(() => new Promise(resolve => { finishB = resolve; })) };
  mockSelected = a;
  jest.mocked(apiClient).mockResolvedValue({ ok: true, status: 200, json: async () => ({ owner: 'B' }) } as Response);
  const result = requestOwnerJson('/api/studies/share-links', {
    method: 'GET', messages: { failed: 'Failed', timedOut: 'Timed out', unavailable: 'Unavailable' },
  }).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  // The request captured A synchronously; the asynchronous auth-module lookup now observes B.
  mockSelected = b;
  await waitFor(() => expect(mockHeaderReads).toBeGreaterThan(0));
  mockSelected = a;
  finishB?.('token-B');
  const settled = await result;
  expect(mockSelected.uid).toBe('A');
  expect(settled.error).toMatchObject({ code: 'unauthenticated' });
  expect(settled.value).toBeUndefined();
  expect(apiClient).not.toHaveBeenCalled();
});


it('binds a direct header request to the account that launched it even without an explicit owner argument', async () => {
  jest.clearAllMocks(); mockHeaderReads = 0;
  const a: BrowserUser = { uid: 'A', getIdToken: jest.fn().mockResolvedValue('token-A') };
  let finishB: ((token: string) => void) | undefined;
  const b: BrowserUser = { uid: 'B', getIdToken: jest.fn(() => new Promise(resolve => { finishB = resolve; })) };
  mockSelected = a;
  const result = getAuthenticatedRequestHeaders().then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  mockSelected = b;
  await waitFor(() => expect(mockHeaderReads).toBeGreaterThan(0));
  mockSelected = a;
  finishB?.('token-B');
  const settled = await result;
  expect(settled.error).toMatchObject({ code: 'unauthenticated' });
  expect(settled.value).toBeUndefined();
});
