import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: null },
}));

const { auth: mockAuth } = jest.requireMock('@/services/firebaseAuth.service') as {
  auth: { currentUser: { getIdToken: jest.Mock } | null };
};

describe('getAuthenticatedRequestHeaders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.currentUser = null;
  });

  it('returns a Firebase bearer header for the current browser user', async () => {
    mockAuth.currentUser = { getIdToken: jest.fn().mockResolvedValue('token-123') };

    await expect(getAuthenticatedRequestHeaders()).resolves.toEqual({
      Authorization: 'Bearer token-123',
    });
  });

  it('returns no header when there is no current browser user', async () => {
    await expect(getAuthenticatedRequestHeaders()).resolves.toEqual({});
  });
});
