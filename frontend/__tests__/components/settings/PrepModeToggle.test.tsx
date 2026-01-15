import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import PrepModeToggle from '@/components/settings/PrepModeToggle';
import { useUserSettings } from '@/hooks/useUserSettings';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mocks
const mockUseAuth = jest.fn<{ user: { uid: string } | null }, []>(() => ({ user: { uid: 'test-user-id' } }));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth()
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'settings.prepMode.title': 'Preparation Mode (Beta)',
        'settings.prepMode.description': 'Enable access to the new preparation mode workflow'
      };
      return translations[key] || key;
    }
  })
}));

// Mock user settings hook
const mockUpdatePrepModeAccess = jest.fn();
const mockUseUserSettings = useUserSettings as jest.Mock;
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: jest.fn(),
}));

// Mock console methods to reduce noise
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

describe('PrepModeToggle Component', () => {
  const resetScenario = () => {
    jest.clearAllMocks();
    mockUpdatePrepModeAccess.mockReset();
    mockUseAuth.mockReturnValue({ user: { uid: 'test-user-id' } });
    mockUseUserSettings.mockReturnValue({
      settings: { enablePrepMode: false },
      loading: false,
      updatePrepModeAccess: mockUpdatePrepModeAccess,
    });
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
      await runScenarios(
        [
          {
            name: 'displays loading animation',
            run: () => {
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: null,
                loading: true,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
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
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: true },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });

              render(<PrepModeToggle />);

              await waitFor(() => {
                const toggle = screen.getByRole('switch');
                expect(toggle).toBeChecked();
                expect(toggle).toHaveClass('bg-blue-600');
              });
            }
          },
          {
            name: 'loads disabled setting and shows toggle as off',
            run: async () => {
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: false },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });

              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              expect(toggle).not.toBeChecked();
              expect(toggle).toHaveClass('bg-gray-200');
            }
          },
          {
            name: 'handles null settings gracefully',
            run: async () => {
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: null,
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });

              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              expect(toggle).not.toBeChecked();
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
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: false },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              expect(toggle).not.toBeChecked();

              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith(true);
                expect(toggle).toHaveAttribute('aria-checked', 'true');
                expect(toggle).toHaveClass('bg-blue-600');
              });
            }
          },
          {
            name: 'successfully toggles from on to off',
            run: async () => {
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: true },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });

              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              expect(toggle).toBeChecked();

              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith(false);
                expect(toggle).toHaveAttribute('aria-checked', 'false');
                expect(toggle).toHaveClass('bg-gray-200');
              });
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
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: null,
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              render(<PrepModeToggle />);

              const toggle = screen.getByRole('switch');
              expect(toggle).not.toBeChecked();
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
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: false },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
              mockUpdatePrepModeAccess.mockRejectedValue(new Error('Update failed'));
              const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
              const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith(true);
              });

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith(
                  '❌ PrepModeToggle: Error updating prep mode:',
                  expect.any(Error)
                );
                expect(alertSpy).toHaveBeenCalledWith('Failed to update setting');
              });

              // Toggle should revert to previous state
              expect(toggle).not.toBeChecked();
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
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: null,
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
              render(<PrepModeToggle />);

              await waitFor(() => {
                expect(consoleSpy).toHaveBeenCalledWith('❌ PrepModeToggle: no user.uid, skipping load');
              });

              const toggle = screen.getByRole('switch');
              expect(toggle).not.toBeChecked();
              consoleSpy.mockRestore();
            }
          },
          {
            name: 'prevents toggle when no user',
            run: async () => {
              mockUseAuth.mockReturnValue({ user: null });
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: null,
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
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
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: true },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              expect(toggle).toBeInTheDocument();
              expect(toggle).toBeChecked();

              expect(screen.getByText('Preparation Mode (Beta)')).toBeInTheDocument();
              expect(screen.getByText('Enable access to the new preparation mode workflow')).toBeInTheDocument();
            }
          },
          {
            name: 'applies correct CSS classes for enabled state',
            run: async () => {
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: true },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });

              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              await waitFor(() => {
                expect(toggle).toHaveClass('bg-blue-600');
                const thumb = toggle.querySelector('span');
                expect(thumb).toHaveClass('translate-x-6'); // Thumb position for enabled
              });
            }
          },
          {
            name: 'applies correct CSS classes for disabled state',
            run: async () => {
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: false },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });

              render(<PrepModeToggle />);

              const toggle = await screen.findByRole('switch');
              await waitFor(() => {
                expect(toggle).toHaveClass('bg-gray-200');
                const thumb = toggle.querySelector('span');
                expect(thumb).toHaveClass('translate-x-1'); // Thumb position for disabled
              });
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
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: true },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
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
              mockUpdatePrepModeAccess.mockResolvedValue(undefined);
              (useUserSettings as jest.Mock).mockReturnValue({
                settings: { enablePrepMode: true },
                loading: false,
                updatePrepModeAccess: mockUpdatePrepModeAccess,
              });
              const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
              render(<PrepModeToggle />);

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
