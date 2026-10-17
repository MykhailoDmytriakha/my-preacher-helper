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
      // No language cookie: the interface speaks English, and the request says so.
      'x-app-language': 'en',
    });
  });

  it('returns no bearer header when there is no current browser user, only the language', async () => {
    await expect(getAuthenticatedRequestHeaders()).resolves.toEqual({ 'x-app-language': 'en' });
  });

  // The server reads a note's old references in the author's language: it travels with "who I am".
  it('says the interface’s language the browser keeps', async () => {
    mockAuth.currentUser = { getIdToken: jest.fn().mockResolvedValue('token-123') };
    document.cookie = 'lang=uk; path=/';
    try {
      await expect(getAuthenticatedRequestHeaders()).resolves.toEqual({ Authorization: 'Bearer token-123', 'x-app-language': 'uk' });
    } finally {
      document.cookie = 'lang=; max-age=0; path=/';
    }
  });
});
