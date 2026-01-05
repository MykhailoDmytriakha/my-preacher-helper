import { NextRequest } from 'next/server';

import { GET, PUT, POST } from '@/api/user/settings/route';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock NextRequest and NextResponse
jest.mock('next/server', () => ({
  NextRequest: jest.fn().mockImplementation((input, init = {}) => {
    const rawBody = init.body;
    return {
      url: typeof input === 'string' ? input : input?.url || '',
      json: async () => {
        if (typeof rawBody === 'string') {
          return JSON.parse(rawBody);
        }
        return rawBody ?? {};
      },
      ...init
    };
  }),
  NextResponse: {
    json: jest.fn((data, options) => ({ status: options?.status || 200, json: async () => data }))
  }
}));

// Mock the repository
const mockGetByUserId = jest.fn();
const mockCreateOrUpdate = jest.fn();

jest.mock('@/api/repositories/userSettings.repository', () => ({
  userSettingsRepository: {
    getByUserId: (...args: any[]) => mockGetByUserId(...args),
    createOrUpdate: (...args: any[]) => mockCreateOrUpdate(...args)
  }
}));

describe('User Settings API Route', () => {
  const resetScenario = () => {
    jest.clearAllMocks();
    mockGetByUserId.mockReset();
    mockCreateOrUpdate.mockReset();
  };

  beforeEach(resetScenario);

  describe('GET /api/user/settings', () => {
    it('handles user settings retrieval', async () => {
      await runScenarios(
        [
          {
            name: 'returns user settings when found',
            run: async () => {
              const mockSettings = {
                id: 'user1',
                language: 'en',
                enablePrepMode: true,
                email: 'test@example.com'
              };

              mockGetByUserId.mockResolvedValue(mockSettings);

              const request = new NextRequest('http://localhost/api/user/settings?userId=user1');
              const response = await GET(request);
              const data = await response.json();

              expect(mockGetByUserId).toHaveBeenCalledWith('user1');
              expect(response.status).toBe(200);
              expect(data).toEqual({ settings: mockSettings });
            }
          },
          {
            name: 'returns null settings when user not found',
            run: async () => {
              mockGetByUserId.mockResolvedValue(null);

              const request = new NextRequest('http://localhost/api/user/settings?userId=nonexistent');
              const response = await GET(request);
              const data = await response.json();

              expect(mockGetByUserId).toHaveBeenCalledWith('nonexistent');
              expect(response.status).toBe(200);
              expect(data).toEqual({ settings: null });
            }
          },
          {
            name: 'returns 400 when userId is missing',
            run: async () => {
              const request = new NextRequest('http://localhost/api/user/settings');
              const response = await GET(request);
              const data = await response.json();

              expect(mockGetByUserId).not.toHaveBeenCalled();
              expect(response.status).toBe(400);
              expect(data).toEqual({ error: 'User ID is required' });
            }
          },
          {
            name: 'handles repository errors gracefully',
            run: async () => {
              mockGetByUserId.mockRejectedValue(new Error('Database error'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              const request = new NextRequest('http://localhost/api/user/settings?userId=user1');
              const response = await GET(request);
              const data = await response.json();

              expect(response.status).toBe(500);
              expect(data).toEqual({ error: 'Failed to fetch user settings' });

              expect(consoleSpy).toHaveBeenCalledWith('Error fetching user settings:', expect.any(Error));

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('PUT /api/user/settings', () => {
    it('handles user settings updates', async () => {
      await runScenarios(
        [
          {
            name: 'updates all fields including enablePrepMode',
            run: async () => {
              mockCreateOrUpdate.mockResolvedValue('user1');

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  userId: 'user1',
                  language: 'ru',
                  email: 'updated@example.com',
                  displayName: 'Updated User',
                  enablePrepMode: true
                })
              });

              const response = await PUT(request);
              const data = await response.json();

              expect(mockCreateOrUpdate).toHaveBeenCalledWith(
                'user1',
                'ru',
                'updated@example.com',
                'Updated User',
                true
              );
              expect(response.status).toBe(200);
              expect(data).toEqual({ success: true });
            }
          },
          {
            name: 'updates only enablePrepMode field',
            run: async () => {
              mockCreateOrUpdate.mockResolvedValue('user1');

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  userId: 'user1',
                  enablePrepMode: false
                })
              });

              const response = await PUT(request);

              expect(mockCreateOrUpdate).toHaveBeenCalledWith(
                'user1',
                undefined,
                undefined,
                undefined,
                false
              );
              expect(response.status).toBe(200);
            }
          },
          {
            name: 'handles partial updates correctly',
            run: async () => {
              mockCreateOrUpdate.mockResolvedValue('user1');

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  userId: 'user1',
                  language: 'fr',
                  enablePrepMode: true
                  // email and displayName not provided
                })
              });

              const response = await PUT(request);

              expect(mockCreateOrUpdate).toHaveBeenCalledWith(
                'user1',
                'fr',
                undefined,
                undefined,
                true
              );
              expect(response.status).toBe(200);
            }
          },
          {
            name: 'returns 400 when userId is missing',
            run: async () => {
              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  language: 'en',
                  enablePrepMode: true
                })
              });

              const response = await PUT(request);
              const data = await response.json();

              expect(mockCreateOrUpdate).not.toHaveBeenCalled();
              expect(response.status).toBe(400);

              expect(data).toEqual({ error: 'User ID is required' });
            }
          },
          {
            name: 'handles repository errors gracefully',
            run: async () => {
              mockCreateOrUpdate.mockRejectedValue(new Error('Database error'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'PUT',
                body: JSON.stringify({
                  userId: 'user1',
                  enablePrepMode: true
                })
              });

              const response = await PUT(request);
              const data = await response.json();

              expect(response.status).toBe(500);
              expect(data).toEqual({ error: 'Failed to update user settings' });

              expect(consoleSpy).toHaveBeenCalledWith('Error updating user settings:', expect.any(Error));

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'handles malformed JSON gracefully',
            run: async () => {
              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'PUT',
                body: 'invalid json'
              });

              const response = await PUT(request);

              expect(response.status).toBe(500);
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('POST /api/user/settings', () => {
    it('handles user settings creation', async () => {
      await runScenarios(
        [
          {
            name: 'creates new user settings with all fields',
            run: async () => {
              mockCreateOrUpdate.mockResolvedValue('new-user');

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'POST',
                body: JSON.stringify({
                  userId: 'new-user',
                  language: 'de',
                  email: 'new@example.com',
                  displayName: 'New User',
                  enablePrepMode: true
                })
              });

              const response = await POST(request);
              const data = await response.json();

              expect(mockCreateOrUpdate).toHaveBeenCalledWith(
                'new-user',
                'de',
                'new@example.com',
                'New User',
                true
              );
              expect(response.status).toBe(200);
              expect(data).toEqual({ success: true });
            }
          },
          {
            name: 'creates settings with default language when not provided',
            run: async () => {
              mockCreateOrUpdate.mockResolvedValue('new-user');

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'POST',
                body: JSON.stringify({
                  userId: 'new-user',
                  email: 'test@example.com',
                  enablePrepMode: false
                })
              });

              const response = await POST(request);

              expect(mockCreateOrUpdate).toHaveBeenCalledWith(
                'new-user',
                'en', // Default language
                'test@example.com',
                undefined,
                false
              );
              expect(response.status).toBe(200);
            }
          },
          {
            name: 'handles creation with only userId',
            run: async () => {
              mockCreateOrUpdate.mockResolvedValue('minimal-user');

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'POST',
                body: JSON.stringify({
                  userId: 'minimal-user'
                })
              });

              const response = await POST(request);

              expect(mockCreateOrUpdate).toHaveBeenCalledWith(
                'minimal-user',
                'en', // Default language
                undefined,
                undefined,
                undefined
              );
              expect(response.status).toBe(200);
            }
          },
          {
            name: 'returns 400 when userId is missing',
            run: async () => {
              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'POST',
                body: JSON.stringify({
                  language: 'en'
                })
              });

              const response = await POST(request);
              const data = await response.json();

              expect(mockCreateOrUpdate).not.toHaveBeenCalled();
              expect(response.status).toBe(400);

              expect(data).toEqual({ error: 'User ID is required' });
            }
          },
          {
            name: 'handles repository errors gracefully',
            run: async () => {
              mockCreateOrUpdate.mockRejectedValue(new Error('Creation failed'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              const request = new NextRequest('http://localhost/api/user/settings', {
                method: 'POST',
                body: JSON.stringify({
                  userId: 'new-user',
                  enablePrepMode: true
                })
              });

              const response = await POST(request);
              const data = await response.json();

              expect(response.status).toBe(500);
              expect(data).toEqual({ error: 'Failed to create user settings' });

              expect(consoleSpy).toHaveBeenCalledWith('Error creating user settings:', expect.any(Error));

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });
});
