import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import PrepModeToggle from '@/components/settings/PrepModeToggle';
import { runScenarios } from '@test-utils/scenarioRunner';
import { TestProviders } from '@test-utils/test-providers';

// Mock all external dependencies
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock user settings service
const mockGetUserSettings = jest.fn();
const mockUpdatePrepModeAccess = jest.fn();
const mockHasPrepModeAccess = jest.fn();

jest.mock('@/services/userSettings.service', () => ({
  getUserSettings: (...args: any[]) => mockGetUserSettings(...args),
  updatePrepModeAccess: (...args: any[]) => mockUpdatePrepModeAccess(...args),
  hasPrepModeAccess: (...args: any[]) => mockHasPrepModeAccess(...args),
  getCookieLanguage: () => 'en'
}));

let prepModeAccessState = { hasAccess: false, loading: false };

jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ ...prepModeAccessState })
}));

// Mock hooks
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'test-user-id' } })
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'settings.prepMode.title': 'Preparation Mode (Beta)',
      'settings.prepMode.description': 'Enable access to the new preparation mode workflow'
    } as Record<string, string>)[key] || key
  })
}));

// Mock navigation components
jest.mock('@/components/navigation/LanguageSwitcher', () => ({
  __esModule: true,
  default: () => <div>Language Switcher</div>
}));

jest.mock('@/components/navigation/UserProfileDropdown', () => ({
  __esModule: true, default: () => <div>User Profile</div>
}));

jest.mock('@/components/navigation/FeedbackModal', () => ({
  __esModule: true, default: () => null
}));

jest.mock('@/components/navigation/MobileMenu', () => ({
  __esModule: true, default: () => <div>Mobile Menu</div>
}));

jest.mock('@/components/navigation/ModeToggle', () => ({
  __esModule: true,
  default: ({ currentMode, onSetMode }: any) => (
    <div data-testid="mode-toggle">
      <button
        data-testid="switch-to-classic"
        onClick={() => onSetMode('classic')}
      >
        Classic Mode
      </button>
      <button
        data-testid="switch-to-prep"
        onClick={() => onSetMode('prep')}
      >
        Prep Mode
      </button>
      <span>Current: {currentMode}</span>
    </div>
  )
}));

// Mock router and navigation
const mockPush = jest.fn();
const mockUsePathname = jest.fn();
const mockUseSearchParams = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockUseSearchParams()
}));

// Mock Next.js Link
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: any) => <a>{children}</a>
}));

// Import components after mocks

describe('Prep Mode Toggle - End-to-End Workflow', () => {
  const resetScenario = () => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    mockGetUserSettings.mockReset();
    mockUpdatePrepModeAccess.mockReset();
    mockHasPrepModeAccess.mockReset();
    mockPush.mockReset();
    mockUsePathname.mockReturnValue('/sermons/test-sermon-id');
    mockUseSearchParams.mockReturnValue({
      get: () => null,
      toString: () => ''
    });
    prepModeAccessState = { hasAccess: false, loading: false };
  };

  beforeEach(resetScenario);
  const renderWithProviders = (ui: React.ReactElement) =>
    render(<TestProviders>{ui}</TestProviders>);

  describe('Complete Prep Mode Enablement Journey', () => {
    it('enables prep mode from settings to navigation', async () => {
      // Initial state: prep mode disabled
      mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
      mockUpdatePrepModeAccess.mockResolvedValue(undefined);
      mockHasPrepModeAccess.mockReturnValue(true);

      await runScenarios(
        [
          {
            name: 'user opens settings and sees prep mode toggle disabled',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
              renderWithProviders(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = await screen.findByRole('switch');
              expect(toggle).not.toBeChecked();
              expect(screen.getByText('Preparation Mode (Beta)')).toBeInTheDocument();
            }
          },
          {
            name: 'user enables prep mode in settings',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
              renderWithProviders(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = await screen.findByRole('switch');
              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith('test-user-id', true);
                expect(toggle).toHaveAttribute('aria-checked', 'true');
              });
            }
          },
          {
            name: 'navigation now shows mode toggle for user',
            run: async () => {
              // Ensure prep mode hook reports access granted
              prepModeAccessState = { hasAccess: true, loading: false };

              renderWithProviders(<DashboardNav />);

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
              expect(screen.getByText('Current: classic')).toBeInTheDocument();
            }
          },
          {
            name: 'user can switch to prep mode in navigation',
            run: async () => {
              prepModeAccessState = { hasAccess: true, loading: false };

              renderWithProviders(<DashboardNav />);

              const prepButton = screen.getByTestId('switch-to-prep');
              fireEvent.click(prepButton);

              expect(mockPush).toHaveBeenCalledWith('/sermons/test-sermon-id?mode=prep', { scroll: false });
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Complete Prep Mode Disablement Journey', () => {
    it('disables prep mode from navigation to settings', async () => {
      // Initial state: prep mode enabled and active
      mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
      mockUpdatePrepModeAccess.mockResolvedValue(undefined);
      mockUseSearchParams.mockReturnValue({
        get: () => 'prep',
        toString: () => 'mode=prep'
      });

      await runScenarios(
        [
          {
            name: 'navigation shows prep mode as active',
            run: async () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              mockUseSearchParams.mockReturnValue({
                get: () => 'prep',
                toString: () => 'mode=prep'
              });
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });

              renderWithProviders(<DashboardNav />);

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
              expect(screen.getByText('Current: prep')).toBeInTheDocument();
            }
          },
          {
            name: 'user switches back to classic mode',
            run: async () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              mockUseSearchParams.mockReturnValue({
                get: () => 'prep',
                toString: () => 'mode=prep'
              });
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });

              renderWithProviders(<DashboardNav />);

              const classicButton = screen.getByTestId('switch-to-classic');
              fireEvent.click(classicButton);

              expect(mockPush).toHaveBeenCalledWith('/sermons/test-sermon-id', { scroll: false });
            }
          },
          {
            name: 'settings shows prep mode as still enabled',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
              renderWithProviders(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = await screen.findByRole('switch');
              expect(toggle).toBeChecked();
            }
          },
          {
            name: 'user disables prep mode in settings',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: true });
              renderWithProviders(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = await screen.findByRole('switch');
              fireEvent.click(toggle);

              await waitFor(() => {
                expect(mockUpdatePrepModeAccess).toHaveBeenCalledWith('test-user-id', false);
                expect(toggle).toHaveAttribute('aria-checked', 'false');
              });
            }
          },
          {
            name: 'navigation hides mode toggle after disabling',
            run: async () => {
              prepModeAccessState = { hasAccess: false, loading: false };

              renderWithProviders(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Error Scenarios and Recovery', () => {
    it('handles settings API failures gracefully', async () => {
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Initial state: disabled
      mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
      // API call fails
      mockUpdatePrepModeAccess.mockRejectedValue(new Error('API Error'));

      await runScenarios(
        [
          {
            name: 'settings toggle fails and shows error',
            run: async () => {
              mockGetUserSettings.mockResolvedValue({ enablePrepMode: false });
              mockUpdatePrepModeAccess.mockRejectedValue(new Error('API Error'));
              renderWithProviders(<PrepModeToggle />);

              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              });

              const toggle = await screen.findByRole('switch');
              expect(toggle).not.toBeChecked();

              fireEvent.click(toggle);

              await waitFor(() => {
                expect(alertSpy).toHaveBeenCalledWith('Failed to update setting');
                expect(consoleSpy).toHaveBeenCalledWith('❌ PrepModeToggle: Error updating prep mode:', expect.any(Error));
                expect(toggle).toHaveAttribute('aria-checked', 'false');
              });
            }
          },
          {
            name: 'navigation remains hidden when settings fail',
            run: async () => {
              prepModeAccessState = { hasAccess: false, loading: false };

              renderWithProviders(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );

      alertSpy.mockRestore();
      consoleSpy.mockRestore();
    });
  });

  describe('Guest User Journey', () => {
    it('guest users always have prep mode access', async () => {
      // Mock guest user (no uid)
      jest.doMock('@/hooks/useAuth', () => ({
        useAuth: () => ({ user: null })
      }));

      mockHasPrepModeAccess.mockResolvedValue(true);

      await runScenarios(
        [
          {
            name: 'guest users bypass settings and always have access',
            run: async () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              mockHasPrepModeAccess.mockResolvedValue(true);

              renderWithProviders(<DashboardNav />);

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Loading and State Transitions', () => {
    it('handles loading states throughout the workflow', async () => {
      await runScenarios(
        [
          {
            name: 'shows loading state during settings fetch',
            run: async () => {
              mockGetUserSettings.mockImplementation(() => new Promise(resolve =>
                setTimeout(() => resolve({ enablePrepMode: true }), 100)
              ));

              renderWithProviders(<PrepModeToggle />);

              // During loading there should be no switch yet
              expect(screen.queryByRole('switch')).not.toBeInTheDocument();

              // Wait for loading to complete
              await waitFor(() => {
                expect(mockGetUserSettings).toHaveBeenCalledWith('test-user-id');
              }, { timeout: 200 });

              const heading = await screen.findByText('Preparation Mode (Beta)');
              expect(heading).toBeInTheDocument();

              const toggle = await screen.findByRole('switch');
              expect(toggle).toBeChecked();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });
});
