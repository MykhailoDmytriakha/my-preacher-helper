import { runScenarios } from '@test-utils/scenarioRunner';

// Mock Firebase Admin
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockDocRef = jest.fn(() => ({
  get: mockGet,
  set: mockSet,
  update: mockUpdate
}));
const mockCollection = jest.fn(() => ({
  doc: mockDocRef
}));

jest.doMock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: mockCollection
  }
}));

const { userSettingsRepository } = require('@/api/repositories/userSettings.repository');

describe('UserSettingsRepository', () => {
  const resetScenario = () => {
    jest.clearAllMocks();

    // Reset all mock implementations
    mockCollection.mockReturnValue({
      doc: mockDocRef
    });
    mockDocRef.mockReturnValue({
      get: mockGet,
      set: mockSet,
      update: mockUpdate
    });
    mockGet.mockResolvedValue({
      exists: true,
      id: 'test-user-id',
      data: () => ({
        language: 'en',
        enablePrepMode: true,
        email: 'test@example.com'
      })
    });
    mockSet.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  };

  beforeEach(resetScenario);

  describe('getByUserId', () => {
    it('retrieves existing user settings', async () => {
      await runScenarios(
        [
          {
            name: 'returns formatted user settings when document exists',
            run: async () => {
              const result = await userSettingsRepository.getByUserId('test-user-id');

              expect(mockCollection).toHaveBeenCalledWith('users');
              expect(mockDocRef).toHaveBeenCalledWith('test-user-id');
              expect(mockGet).toHaveBeenCalled();

              expect(result).toEqual({
                id: 'test-user-id',
                language: 'en',
                enablePrepMode: true,
                email: 'test@example.com'
              });
            }
          },
          {
            name: 'returns null when document does not exist',
            run: async () => {
              mockGet.mockResolvedValueOnce({
                exists: false
              });

              const result = await userSettingsRepository.getByUserId('nonexistent-user');

              expect(result).toBeNull();
            }
          },
          {
            name: 'handles database errors gracefully',
            run: async () => {
              mockGet.mockRejectedValueOnce(new Error('Database connection failed'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(userSettingsRepository.getByUserId('test-user-id')).rejects.toThrow('Database connection failed');

              expect(consoleSpy).toHaveBeenCalledWith('Error fetching user settings:', expect.any(Error));

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });

  describe('createOrUpdate', () => {
    it('handles document creation and updates', async () => {
      await runScenarios(
        [
          {
            name: 'creates new document when user does not exist',
            run: async () => {
              mockGet.mockResolvedValueOnce({
                exists: false
              });

              const result = await userSettingsRepository.createOrUpdate(
                'new-user-id',
                'en',
                'new@example.com',
                'New User',
                true
              );

              expect(result).toBe('new-user-id');
              expect(mockSet).toHaveBeenCalledWith({
                language: 'en', // Set to default when not provided
                email: 'new@example.com',
                displayName: 'New User',
                enablePrepMode: true
              });
              expect(mockUpdate).not.toHaveBeenCalled();
            }
          },
          {
            name: 'updates existing document with all fields',
            run: async () => {
              const result = await userSettingsRepository.createOrUpdate(
                'existing-user-id',
                'ru',
                'updated@example.com',
                'Updated User',
                false
              );

              expect(result).toBe('existing-user-id');
              expect(mockUpdate).toHaveBeenCalledWith({
                language: 'ru',
                email: 'updated@example.com',
                displayName: 'Updated User',
                enablePrepMode: false
              });
              expect(mockSet).not.toHaveBeenCalled();
            }
          },
          {
            name: 'handles partial updates (only some fields provided)',
            run: async () => {
              const result = await userSettingsRepository.createOrUpdate(
                'existing-user-id',
                undefined, // language not provided
                'email@example.com', // email provided
                undefined, // displayName not provided
                undefined // enablePrepMode not provided
              );

              expect(result).toBe('existing-user-id');
              expect(mockUpdate).toHaveBeenCalledWith({
                email: 'email@example.com'
              });
              expect(mockSet).not.toHaveBeenCalled();
            }
          },
          {
            name: 'skips update when no fields provided',
            run: async () => {
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

              const result = await userSettingsRepository.createOrUpdate(
                'existing-user-id',
                undefined,
                undefined,
                undefined,
                undefined
              );

              expect(result).toBe('existing-user-id');
              expect(mockUpdate).not.toHaveBeenCalled();
              expect(mockSet).not.toHaveBeenCalled();
              expect(consoleSpy).toHaveBeenCalledWith("No fields to update for user:", 'existing-user-id');

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'logs update operations',
            run: async () => {
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

              await userSettingsRepository.createOrUpdate(
                'existing-user-id',
                'fr',
                undefined,
                undefined,
                true
              );

              expect(consoleSpy).toHaveBeenCalledWith(
                "Updating user settings for user:",
                'existing-user-id',
                "with updates:",
                { language: 'fr', enablePrepMode: true }
              );

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'handles creation errors gracefully',
            run: async () => {
              mockGet.mockResolvedValueOnce({
                exists: false
              });
              mockSet.mockRejectedValueOnce(new Error('Creation failed'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(userSettingsRepository.createOrUpdate(
                'new-user-id',
                'en',
                'test@example.com'
              )).rejects.toThrow('Creation failed');

              expect(consoleSpy).toHaveBeenCalledWith('Error creating/updating user settings:', expect.any(Error));

              consoleSpy.mockRestore();
            }
          },
          {
            name: 'handles update errors gracefully',
            run: async () => {
              mockUpdate.mockRejectedValueOnce(new Error('Update failed'));

              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

              await expect(userSettingsRepository.createOrUpdate(
                'existing-user-id',
                'es'
              )).rejects.toThrow('Update failed');

              expect(consoleSpy).toHaveBeenCalledWith('Error creating/updating user settings:', expect.any(Error));

              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });

    it('handles prep mode field specifically', async () => {
      await runScenarios(
        [
          {
            name: 'creates document with prep mode enabled',
            run: async () => {
              mockGet.mockResolvedValueOnce({
                exists: false
              });

              await userSettingsRepository.createOrUpdate(
                'new-user-id',
                'en',
                undefined,
                undefined,
                true
              );

              expect(mockSet).toHaveBeenCalledWith({
                language: 'en',
                enablePrepMode: true
              });
            }
          },
          {
            name: 'updates prep mode from enabled to disabled',
            run: async () => {
              await userSettingsRepository.createOrUpdate(
                'existing-user-id',
                undefined,
                undefined,
                undefined,
                false
              );

              expect(mockUpdate).toHaveBeenCalledWith({
                enablePrepMode: false
              });
            }
          },
          {
            name: 'preserves other fields when updating prep mode',
            run: async () => {
              // Existing document has other fields that should be preserved
              mockGet.mockResolvedValue({
                exists: true,
                data: () => ({
                  language: 'en',
                  email: 'existing@example.com',
                  displayName: 'Existing User',
                  enablePrepMode: true,
                  isAdmin: false
                })
              });

              await userSettingsRepository.createOrUpdate(
                'existing-user-id',
                undefined,
                undefined,
                undefined,
                false
              );

              expect(mockUpdate).toHaveBeenCalledWith({
                enablePrepMode: false
              });
              // Note: Firebase update() only updates the specified fields,
              // other fields like isAdmin should remain unchanged
            }
          }
        ],
        { beforeEachScenario: resetScenario }
      );
    });
  });
});
