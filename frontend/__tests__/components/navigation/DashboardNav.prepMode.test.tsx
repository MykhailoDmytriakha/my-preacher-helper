import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mocks
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: any) => <a>{children}</a> }));

const replaceMock = jest.fn();
const pushMock = jest.fn();
let pathnameMock = '/sermons/abc';

const OLD_ENV = process.env;
const resetScenario = () => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  replaceMock.mockReset();
  pushMock.mockReset();
  pathnameMock = '/sermons/abc';
  prepModeAccessState = { hasAccess: true, loading: false };
};

jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useSearchParams: () => ({
    get: () => 'prep',
    toString: () => 'mode=prep'
  }),
}));

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, handleLogout: jest.fn() }) }));
jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: jest.fn(),
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: jest.fn(),
  })
}));
jest.mock('@/components/navigation/LanguageSwitcher', () => ({ __esModule: true, default: () => <div data-testid="lang-switch" /> }));
jest.mock('@/components/navigation/UserProfileDropdown', () => ({ __esModule: true, default: () => <div data-testid="user-dropdown" /> }));
jest.mock('@/components/navigation/FeedbackModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/navigation/MobileMenu', () => ({ __esModule: true, default: () => <div data-testid="mobile-menu" /> }));

let prepModeAccessState = { hasAccess: true, loading: false };

jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ ...prepModeAccessState })
}));

// Mock ModeToggle
jest.mock('@/components/navigation/ModeToggle', () => ({
  __esModule: true,
  default: () => <div data-testid="mode-toggle">Mode Toggle</div>
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => ({
      'navigation.primary': 'Navigation',
      'navigation.dashboard': 'Dashboard',
      'wizard.switchToClassic': 'Classic Mode',
      'wizard.switchToPrepBeta': 'Preparation Mode (Beta)',
      'wizard.previewButton': 'Preparation Mode',
      'feedback.button': 'Feedback',
    } as Record<string, string>)[k] || k,
  })
}));

describe('DashboardNav - Prep Mode Access Integration', () => {
  beforeEach(resetScenario);
  afterAll(() => { process.env = OLD_ENV; });

  describe('Mode Toggle Visibility Based on Prep Mode Access', () => {
    it('shows mode toggle when user has prep mode access', async () => {

      await runScenarios(
        [
          {
            name: 'displays mode toggle for sermon root page when access granted',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/sermons/test-sermon-id';
              render(<DashboardNav />);

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
              expect(screen.getByText('Mode Toggle')).toBeInTheDocument();
            }
          },
          {
            name: 'shows toggle on sermon plan page when access granted',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/sermons/test-sermon-id/plan';
              render(<DashboardNav />);

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
            }
          },
          {
            name: 'shows toggle on structure page when access granted',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/structure';
              render(<DashboardNav />);

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });

    it('hides mode toggle when user lacks prep mode access', async () => {

      await runScenarios(
        [
          {
            name: 'hides mode toggle when access denied',
            run: () => {
              prepModeAccessState = { hasAccess: false, loading: false };
              pathnameMock = '/sermons/test-sermon-id';
              render(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
              expect(screen.queryByText('Mode Toggle')).not.toBeInTheDocument();
            }
          },
          {
            name: 'remains hidden on all sermon-related pages when access denied',
            run: () => {
              prepModeAccessState = { hasAccess: false, loading: false };
              const sermonPaths = [
                '/sermons/test-id',
                '/sermons/test-id/plan',
                '/structure'
              ];

              sermonPaths.forEach(path => {
                pathnameMock = path;
                render(<DashboardNav />);

                expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
                cleanup();
              });
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });

    it('handles loading state for prep mode access', async () => {

      await runScenarios(
        [
          {
            name: 'hides mode toggle while access is loading',
            run: () => {
              prepModeAccessState = { hasAccess: false, loading: true };
              pathnameMock = '/sermons/test-sermon-id';
              render(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });

    it('never shows mode toggle on non-sermon pages', async () => {

      await runScenarios(
        [
          {
            name: 'hides toggle on dashboard page even with access',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/dashboard';
              render(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          },
          {
            name: 'hides toggle on series page even with access',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/series';
              render(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          },
          {
            name: 'hides toggle on settings page even with access',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/settings';
              render(<DashboardNav />);

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });

  describe('Console Logging for Prep Mode Access', () => {
    it('logs access check results', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runScenarios(
        [
          {
            name: 'logs prep mode access status and loading state',
            run: () => {
              prepModeAccessState = { hasAccess: true, loading: false };
              pathnameMock = '/sermons/test-sermon-id';
              render(<DashboardNav />);

              expect(consoleSpy).toHaveBeenCalledWith('🔧 DashboardNav: showWizardButton:', true, 'prepModeLoading:', false);
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );

      consoleSpy.mockRestore();
    });
  });
});
