import {
  getCookieLanguage,
  getUserLanguage,
  getUserSettings,
  hasGroupsAccess,
  hasPrepModeAccess,
  hasStructurePreviewAccess,
  initializeUserSettings,
  setLanguageCookie,
  updateAudioGenerationAccess,
  updateGroupsAccess,
  updatePrepModeAccess,
  updateUserLanguage,
  updateUserProfile,
  updateStructurePreviewAccess
} from '@/services/userSettings.service';
import { runScenarios } from '@test-utils/scenarioRunner';
import { COOKIE_LANG_KEY, DEFAULT_LANGUAGE } from '@/../../frontend/locales/constants';
import { setDebugModeEnabled } from '@/utils/debugMode';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('User Settings Service - Prep Mode Functions', () => {
  const clearLanguageCookie = () => {
    document.cookie = `${COOKIE_LANG_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  };

  const setNavigatorOnline = (value: boolean) => {
    Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  };

  const resetScenario = () => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    clearLanguageCookie();
    setNavigatorOnline(true);
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
          },
          {
            name: 'throws when browser is offline',
            run: async () => {
              setNavigatorOnline(false);
              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(getUserSettings('user1')).rejects.toThrow('Offline: operation not available.');
              expect(mockFetch).not.toHaveBeenCalled();

              consoleSpy.mockRestore();
              setNavigatorOnline(true);
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
          },
          {
            name: 'throws when browser is offline',
            run: async () => {
              setNavigatorOnline(false);
              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(updatePrepModeAccess('user1', true)).rejects.toThrow('Offline: operation not available.');
              expect(mockFetch).not.toHaveBeenCalled();

              consoleSpy.mockRestore();
              setNavigatorOnline(true);
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
          },
          {
            name: 'returns false when browser is offline',
            run: async () => {
              setNavigatorOnline(false);

              const result = await hasPrepModeAccess('user1');

              expect(result).toBe(false);
              expect(mockFetch).not.toHaveBeenCalled();

              setNavigatorOnline(true);
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('updateGroupsAccess', () => {
    it('updates groups access successfully and handles errors', async () => {
      await runScenarios(
        [
          {
            name: 'successfully updates groups feature to enabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ success: true })
              });

              await expect(updateGroupsAccess('user1', true)).resolves.toBeUndefined();
              expect(mockFetch).toHaveBeenCalledWith('/api/user/settings', expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ userId: 'user1', enableGroups: true }),
              }));
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

              await expect(updateGroupsAccess('user1', true)).rejects.toThrow();
            }
          },
          {
            name: 'throws when browser is offline',
            run: async () => {
              setNavigatorOnline(false);

              await expect(updateGroupsAccess('user1', true)).rejects.toThrow('Offline: operation not available.');
              expect(mockFetch).not.toHaveBeenCalled();

              setNavigatorOnline(true);
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('hasGroupsAccess', () => {
    it('returns groups feature access state', async () => {
      await runScenarios(
        [
          {
            name: 'returns false for empty user id',
            run: async () => {
              const result = await hasGroupsAccess('');
              expect(result).toBe(false);
              expect(mockFetch).not.toHaveBeenCalled();
            }
          },
          {
            name: 'returns true when groups feature is enabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({ settings: { enableGroups: true } })
              });

              const result = await hasGroupsAccess('user1');
              expect(result).toBe(true);
            }
          },
          {
            name: 'returns false on errors',
            run: async () => {
              mockFetch.mockRejectedValueOnce(new Error('Network error'));
              const result = await hasGroupsAccess('user1');
              expect(result).toBe(false);
            }
          },
          {
            name: 'returns false when browser is offline',
            run: async () => {
              setNavigatorOnline(false);

              const result = await hasGroupsAccess('user1');

              expect(result).toBe(false);
              expect(mockFetch).not.toHaveBeenCalled();

              setNavigatorOnline(true);
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('updateStructurePreviewAccess', () => {
    it('updates structure preview access successfully and handles errors', async () => {
      await runScenarios(
        [
          {
            name: 'resolves immediately for empty userId',
            run: async () => {
              await expect(updateStructurePreviewAccess('', true)).resolves.toBeUndefined();
              expect(mockFetch).not.toHaveBeenCalled();
            }
          },
          {
            name: 'successfully updates structure preview to enabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

              await expect(updateStructurePreviewAccess('user1', true)).resolves.toBeUndefined();
              expect(mockFetch).toHaveBeenCalledWith('/api/user/settings', expect.objectContaining({
                method: 'PUT',
                body: JSON.stringify({ userId: 'user1', enableStructurePreview: true }),
              }));
            }
          },
          {
            name: 'successfully updates structure preview to disabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

              await expect(updateStructurePreviewAccess('user1', false)).resolves.toBeUndefined();
              expect(mockFetch).toHaveBeenCalledWith('/api/user/settings', expect.objectContaining({
                body: JSON.stringify({ userId: 'user1', enableStructurePreview: false }),
              }));
            }
          },
          {
            name: 'throws on API error response',
            run: async () => {
              mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error' });
              await expect(updateStructurePreviewAccess('user1', true)).rejects.toThrow();
            }
          },
          {
            name: 'throws on network error',
            run: async () => {
              mockFetch.mockRejectedValueOnce(new Error('Network error'));
              await expect(updateStructurePreviewAccess('user1', true)).rejects.toThrow('Network error');
            }
          },
          {
            name: 'throws when browser is offline',
            run: async () => {
              Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
              await expect(updateStructurePreviewAccess('user1', true)).rejects.toThrow();
              Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('hasStructurePreviewAccess', () => {
    it('returns structure preview access state', async () => {
      await runScenarios(
        [
          {
            name: 'returns false for empty user id',
            run: async () => {
              const result = await hasStructurePreviewAccess('');
              expect(result).toBe(false);
              expect(mockFetch).not.toHaveBeenCalled();
            }
          },
          {
            name: 'returns true when structure preview is enabled',
            run: async () => {
              mockFetch.mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({ settings: { enableStructurePreview: true } })
              });
              const result = await hasStructurePreviewAccess('user1');
              expect(result).toBe(true);
            }
          },
          {
            name: 'returns false when structure preview is not set',
            run: async () => {
              mockFetch.mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({ settings: {} })
              });
              const result = await hasStructurePreviewAccess('user1');
              expect(result).toBe(false);
            }
          },
          {
            name: 'returns false on network errors',
            run: async () => {
              mockFetch.mockRejectedValueOnce(new Error('Network error'));
              const result = await hasStructurePreviewAccess('user1');
              expect(result).toBe(false);
            }
          },
          {
            name: 'returns false when browser is offline',
            run: async () => {
              Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
              const result = await hasStructurePreviewAccess('user1');
              expect(result).toBe(false);
              Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('language helpers', () => {
    it('reads language from cookie and falls back to default', () => {
      expect(getCookieLanguage()).toBe(DEFAULT_LANGUAGE);

      setLanguageCookie('uk');

      expect(document.cookie).toContain(`${COOKIE_LANG_KEY}=uk`);
      expect(getCookieLanguage()).toBe('uk');
    });
  });

  describe('getUserLanguage', () => {
    it('uses cookie immediately for guest and offline users', async () => {
      setLanguageCookie('uk');

      await expect(getUserLanguage('')).resolves.toBe('uk');
      expect(mockFetch).not.toHaveBeenCalled();

      setNavigatorOnline(false);
      await expect(getUserLanguage('user1')).resolves.toBe('uk');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns database language and syncs the cookie when needed', async () => {
      setLanguageCookie('ru');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ settings: { language: 'en' } }),
      });

      const result = await getUserLanguage('user1');

      expect(result).toBe('en');
      expect(mockFetch).toHaveBeenCalledWith('/api/user/settings?userId=user1');
      expect(getCookieLanguage()).toBe('en');
    });

    it('persists a non-default cookie to settings when the database has no language', async () => {
      setLanguageCookie('uk');
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ settings: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ success: true }),
        });

      const result = await getUserLanguage('user1');

      expect(result).toBe('uk');
      expect(mockFetch).toHaveBeenNthCalledWith(1, '/api/user/settings?userId=user1');
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        '/api/user/settings',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ userId: 'user1', language: 'uk' }),
        })
      );
    });

    it('falls back to the cookie when the fetch fails', async () => {
      setLanguageCookie('ru');
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: jest.fn().mockResolvedValue({}),
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(getUserLanguage('user1')).resolves.toBe('ru');
      expect(consoleSpy).toHaveBeenCalledWith('Error getting user language:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('updateUserLanguage', () => {
    it('updates cookie only for guests and offline users', async () => {
      await expect(updateUserLanguage('', 'uk')).resolves.toBeUndefined();
      expect(getCookieLanguage()).toBe('uk');
      expect(mockFetch).not.toHaveBeenCalled();

      setNavigatorOnline(false);
      await expect(updateUserLanguage('user1', 'ru')).resolves.toBeUndefined();
      expect(getCookieLanguage()).toBe('ru');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('updates the database for authenticated online users', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ success: true }) });

      await expect(updateUserLanguage('user1', 'uk')).resolves.toBeUndefined();

      expect(getCookieLanguage()).toBe('uk');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/user/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ userId: 'user1', language: 'uk' }),
        })
      );
    });

    it('logs update failures but keeps the cookie change', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Server Error' });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(updateUserLanguage('user1', 'ru')).resolves.toBeUndefined();

      expect(getCookieLanguage()).toBe('ru');
      expect(consoleSpy).toHaveBeenCalledWith('Error updating user language:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('updateUserProfile', () => {
    it('skips empty, offline, and no-op profile updates', async () => {
      await expect(updateUserProfile('')).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();

      setNavigatorOnline(false);
      await expect(updateUserProfile('user1', 'user@example.com')).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();

      setNavigatorOnline(true);
      await expect(updateUserProfile('user1')).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('updates only provided profile fields', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ success: true }) });

      await expect(updateUserProfile('user1', 'user@example.com', 'Test User')).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/user/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            userId: 'user1',
            email: 'user@example.com',
            displayName: 'Test User',
          }),
        })
      );
    });

    it('logs profile update failures without throwing', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Server Error' });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(updateUserProfile('user1', undefined, 'Name')).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith('Error updating user profile:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('initializeUserSettings', () => {
    it('skips initialization without user id and sets cookie when offline', async () => {
      await expect(initializeUserSettings('', 'uk')).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();

      setNavigatorOnline(false);
      await expect(initializeUserSettings('user1', 'ru')).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(getCookieLanguage()).toBe('ru');
    });

    it('posts only provided fields and updates the cookie when language exists', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ success: true }) });

      await expect(
        initializeUserSettings('user1', 'uk', 'user@example.com', 'Test User')
      ).resolves.toBeUndefined();

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/user/settings',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            userId: 'user1',
            language: 'uk',
            email: 'user@example.com',
            displayName: 'Test User',
          }),
        })
      );
      expect(getCookieLanguage()).toBe('uk');
    });

    it('keeps the cookie update when initialization fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Server Error' });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(initializeUserSettings('user1', 'ru')).resolves.toBeUndefined();
      expect(getCookieLanguage()).toBe('ru');
      expect(consoleSpy).toHaveBeenCalledWith('Error initializing user settings:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('updateAudioGenerationAccess', () => {
    it('updates audio generation access and handles skip conditions', async () => {
      await expect(updateAudioGenerationAccess('', true)).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();

      mockFetch.mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue({ success: true }) });
      await expect(updateAudioGenerationAccess('user1', true)).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/user/settings',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ userId: 'user1', enableAudioGeneration: true }),
        })
      );
    });

    it('throws on offline and request failures', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      setNavigatorOnline(false);
      await expect(updateAudioGenerationAccess('user1', true)).rejects.toThrow();

      setNavigatorOnline(true);
      mockFetch.mockResolvedValueOnce({ ok: false, statusText: 'Bad Request' });
      await expect(updateAudioGenerationAccess('user1', false)).rejects.toThrow('Failed to update audio generation access: Bad Request');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      await expect(updateAudioGenerationAccess('user1', false)).rejects.toThrow('Network error');
      expect(consoleSpy).toHaveBeenCalledWith('Error updating audio generation access:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });
});
