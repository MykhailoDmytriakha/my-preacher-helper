import {
  getUserSettings,
  updatePrepModeAccess,
  hasPrepModeAccess
} from '@/services/userSettings.service';
import { runScenarios } from '@test-utils/scenarioRunner';
import { setDebugModeEnabled } from '@/utils/debugMode';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('User Settings Service - Prep Mode Functions', () => {
  const resetScenario = () => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    // Enable debug mode for tests to verify logging
    setDebugModeEnabled(true);
  };

  beforeEach(resetScenario);

  describe('getUserSettings', () => {
    it('fetches user settings successfully', async () => {
      const mockSettings = { id: 'user1', language: 'en', enablePrepMode: true };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ settings: mockSettings }),
        status: 200,
        statusText: 'OK'
      });

      await runScenarios(
        [
          {
            name: 'returns settings when fetch succeeds',
            run: async () => {
              const result = await getUserSettings('user1');

              expect(mockFetch).toHaveBeenCalledWith('/api/user/settings?userId=user1');
              expect(result).toEqual(mockSettings);
            }
          },
          {
            name: 'returns null when userId is empty',
            run: async () => {
              const result = await getUserSettings('');

              expect(mockFetch).not.toHaveBeenCalled();
              expect(result).toBeNull();
            }
          },
          {
            name: 'throws on API errors',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({})
      });

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(getUserSettings('user1')).rejects.toThrow();
              expect(consoleSpy).toHaveBeenCalledWith(
                'Error getting user settings:',
                expect.any(Error)
              );

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'throws on network errors',
            run: async () => {
              mockFetch.mockRejectedValueOnce(new Error('Network error'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(getUserSettings('user1')).rejects.toThrow('Network error');
              expect(consoleSpy).toHaveBeenCalledWith(
                'Error getting user settings:',
                expect.any(Error)
              );

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('updatePrepModeAccess', () => {
    it('updates prep mode access successfully', async () => {
      await runScenarios(
        [
          {
            name: 'successfully updates prep mode to enabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true })
              });

              await expect(updatePrepModeAccess('user1', true)).resolves.toBeUndefined();

              expect(mockFetch).toHaveBeenCalledWith('/api/user/settings', expect.objectContaining({
                method: 'PUT',
                headers: expect.objectContaining({
                  'Content-Type': 'application/json',
                }),
                body: JSON.stringify({ userId: 'user1', enablePrepMode: true }),
              }));
            }
          },
          {
            name: 'successfully updates prep mode to disabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true })
              });

              await expect(updatePrepModeAccess('user1', false)).resolves.toBeUndefined();

              expect(mockFetch).toHaveBeenCalledWith('/api/user/settings', expect.objectContaining({
                method: 'PUT',
                headers: expect.objectContaining({
                  'Content-Type': 'application/json',
                }),
                body: JSON.stringify({ userId: 'user1', enablePrepMode: false }),
              }));
            }
          },
          {
            name: 'does nothing when userId is empty',
            run: async () => {
              await expect(updatePrepModeAccess('', true)).resolves.toBeUndefined();

              expect(mockFetch).not.toHaveBeenCalled();
            }
          },
          {
            name: 'handles API errors and throws',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue({})
      });

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(updatePrepModeAccess('user1', true)).rejects.toThrow();

              expect(consoleSpy).toHaveBeenCalledWith(
                'Error updating prep mode access:',
                expect.any(Error)
              );

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'handles network errors and throws',
            run: async () => {
              mockFetch.mockRejectedValueOnce(new Error('Network error'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(updatePrepModeAccess('user1', true)).rejects.toThrow();

              expect(consoleSpy).toHaveBeenCalledWith(
                'Error updating prep mode access:',
                expect.any(Error)
              );

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('hasPrepModeAccess', () => {
    it('handles different user scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'returns true for guest users (empty userId)',
            run: async () => {
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

              const result = await hasPrepModeAccess('');

              expect(result).toBe(true);
              expect(mockFetch).not.toHaveBeenCalled();
              expect(consoleSpy).toHaveBeenCalledWith('[debug]', '👤 hasPrepModeAccess: guest user, returning true');

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'returns true when authenticated user has prep mode enabled',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ settings: { enablePrepMode: true } })
      });

              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(true);
              expect(consoleSpy).toHaveBeenCalledWith('[debug]', '👤 hasPrepModeAccess: authenticated user, fetching settings...');
              expect(consoleSpy).toHaveBeenCalledWith('[debug]', '📊 hasPrepModeAccess: fetched settings:', { enablePrepMode: true });
              expect(consoleSpy).toHaveBeenCalledWith('[debug]', '✅ hasPrepModeAccess: access result:', true);

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'returns false when authenticated user has prep mode disabled',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ settings: { enablePrepMode: false } })
      });

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(false);
            }
          },
          {
            name: 'returns false when authenticated user has no settings',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ settings: null })
      });

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(false);
            }
          },
          {
            name: 'returns false when authenticated user has settings without prep mode field',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ settings: { language: 'en' } })
      });

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(false);
            }
          },
          {
            name: 'handles API errors and returns false',
            run: async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error',
        json: jest.fn().mockResolvedValue({})
      });

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(false);
              expect(consoleSpy).toHaveBeenCalledWith(
                'Error getting user settings:',
                expect.any(Error)
              );

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'handles network errors and returns false',
            run: async () => {
              mockFetch.mockRejectedValueOnce(new Error('Network error'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(false);
              expect(consoleSpy).toHaveBeenCalledWith(
                'Error getting user settings:',
                expect.any(Error)
              );

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });
});
