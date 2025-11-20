import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import PrepModeToggle from '@/components/settings/PrepModeToggle';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mocks
const mockUseAuth = jest.fn(() => ({ user: { uid: 'test-user-id' } }));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth()
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => {
      const translations: Record<string, string> = {
        'settings.prepMode.title': 'Preparation Mode (Beta)',
        'settings.prepMode.description': 'Enable access to the new preparation mode workflow'
      };
      return translations[key] || key;
    }
  })
}));

// Mock the service functions
const mockGetUserSettings = jest.fn();
const mockUpdatePrepModeAccess = jest.fn();

jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: (...args: any[]) => mockGetUserSettings(...args),
  updatePrepModeAccess: (...args: any[]) => mockUpdatePrepModeAccess(...args)
}));

// Mock console methods to reduce noise
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('PrepModeToggle Component', () => {
  const resetScenario = () => {
    jest.clearAllMocks();
    mockGetUserSettings.mockReset();
    mockUpdatePrepModeAccess.mockReset();
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  };

  beforeEach(resetScenario);
  afterAll(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  describe('Initial Loading State', () => {
    it('shows loading skeleton while fetching settings', async () => {
      mockGetUserSettings.mockImplementation(() => new Promise(() => {})); // Never resolves

      await runScenarios(
        [
          {
            name: 'displays loading animation',
            run: () => {
              render(<PrepModeToggle />);
              expect(screen.queryByRole('switch')).not.toBeInTheDocument();
              expect(screen.queryByText('Preparation Mode (Beta)')).not.toBeInTheDocument();
              expect(screen.getByTestId('prep-mode-loading')).toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Successful Settings Load', () => {
    it('loads and displays enabled state correctly', async () => {
      await runScenarios(
        [
          {
            name: 'loads enabled setting and shows toggle as on',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });

              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              await waitFor(() => {
                const toggle = screen.getByRole('switch');
                expect(toggle).toHaveAttribute('aria-checked', 'true');
                expect(toggle).toHaveClass('bg-blue-600');
              });
            }
          },
          {
            name: 'loads disabled setting and shows toggle as off',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });

              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveAttribute('aria-checked', 'false');
              expect(toggle).toHaveClass('bg-gray-200');
            }
          },
          {
            name: 'handles null settings gracefully',
            run: async () => {
              mockGetUserSettings.mockResolvedValue(null);

              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveAttribute('aria-checked', 'false');
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Toggle Interactions', () => {
    it('handles toggle from disabled to enabled', async () => {

      await runScenarios(
        [
          {
            name: 'successfully toggles from off to on',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveAttribute('aria-checked', 'false');

              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith('test-user-id', true);
              });

              expect(toggle).toHaveAttribute('aria-checked', 'true');
              expect(toggle).toHaveClass('bg-blue-600');
            }
          },
          {
            name: 'successfully toggles from on to off',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);

              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveAttribute('aria-checked', 'true');

              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith('test-user-id', false);
              });

              expect(toggle).toHaveAttribute('aria-checked', 'false');
              expect(toggle).toHaveClass('bg-gray-200');
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Error Handling', () => {
    it('handles loading errors gracefully', async () => {

      await runScenarios(
        [
          {
            name: 'logs error and defaults to disabled state',
            run: async () => {
              mockGetUserSettings.mockRejectedValue(new Error('Network error'));
              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith(
                  '❌ PrepModeToggle: Error loading prep mode setting:',
                  expect.any(Error)
                );
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveAttribute('aria-checked', 'false');
              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });

    it('handles toggle update errors gracefully', async () => {

      await runScenarios(
        [
          {
            name: 'shows alert and logs error on toggle failure',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
              mockUpdatePrepModeAccess.mockRejectedValue(new Error('Update failed'));
              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith('test-user-id', true);
              });

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith(
                  '❌ PrepModeToggle: Error updating prep mode:',
                  expect.any(Error)
                );
                expect(alertSpy).toHaveBeenCalledWith('Failed to update setting');
              });

              // Toggle should revert to previous state
              expect(toggle).toHaveAttribute('aria-checked', 'false');
              consoleSpy.mockRestore();
              alertSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );

    });
  });

  describe('User Authentication Scenarios', () => {
    it('handles missing user gracefully', async () => {

      await runScenarios(
        [
          {
            name: 'logs warning and sets loading to false when no user',
            run: async () => {
              mockUseAuth.mockReturnValue({ user: null });
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('❌ PrepModeToggle: no user.uid, skipping load');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveAttribute('aria-checked', 'false');
              consoleSpy.mockRestore();
            }
          },
          {
            name: 'prevents toggle when no user',
            run: async () => {
              mockUseAuth.mockReturnValue({ user: null });
              render(<PrepModeToggle />);

              const toggle = screen.getByRole('switch');
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
              fireEvent.click(toggle);

              expect(mockUpdatePrepModeAccess).not.toHaveBeenCalled();
              expect(consoleSpy).toHaveBeenCalledWith('❌ PrepModeToggle: handleToggle - no user.uid');
              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );

    });
  });

  describe('Accessibility and UI', () => {
    it('renders correct accessibility attributes and content', async () => {
      await runScenarios(
        [
          {
            name: 'renders proper ARIA attributes and text content',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toBeInTheDocument();
              expect(toggle).toHaveAttribute('aria-checked', 'true');

              expect(screen.getByText('Preparation Mode (Beta)')).toBeInTheDocument();
              expect(screen.getByText('Enable access to the new preparation mode workflow')).toBeInTheDocument();
            }
          },
          {
            name: 'applies correct CSS classes for enabled state',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });

              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveClass('bg-blue-600');
              const thumb = toggle.querySelector('span');
              expect(thumb).toHaveClass('translate-x-6'); // Thumb position for enabled
            }
          },
          {
            name: 'applies correct CSS classes for disabled state',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });

              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).toHaveClass('bg-gray-200');
              const thumb = toggle.querySelector('span');
              expect(thumb).toHaveClass('translate-x-1'); // Thumb position for disabled
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Console Logging', () => {
    it('logs appropriate messages during operation', async () => {

      await runScenarios(
        [
          {
            name: 'logs loading and loaded messages',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('🔍 PrepModeToggle: loading settings for user:', 'test-user-id');
                expect(consoleSpy).toHaveBeenCalledWith('📊 PrepModeToggle: loaded settings:', { enablePrepMode: true });
                expect(consoleSpy).toHaveBeenCalledWith('✅ PrepModeToggle: setting enabled to:', true);
              });
              consoleSpy.mockRestore();
            }
          },
          {
            name: 'logs toggle operations',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              // Wait for loading to complete
              await waitFor(() => {
                expect(screen.queryByTestId('prep-mode-loading')).not.toBeInTheDocument();
              });

              const toggle = screen.getByRole('switch');
              fireEvent.click(toggle);

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('🔄 PrepModeToggle: toggling to:', false, 'for user:', 'test-user-id');
                expect(consoleSpy).toHaveBeenCalledWith('✅ PrepModeToggle: successfully updated setting');
              });
              consoleSpy.mockRestore();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );

    });
  });
});
