import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import { runScenarios } from '@test-utils/scenarioRunner';
import { TestProviders } from '../../../test-utils/test-providers';
import { setDebugModeEnabled } from '@/utils/debugMode';

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
  // Enable debug mode for tests to verify logging
  setDebugModeEnabled(true);
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

describe('DashboardNav - the sermon modes, preparation among them', () => {
  beforeEach(resetScenario);
  afterAll(() => { process.env = OLD_ENV; });

  describe('where the mode switch shows', () => {
    it('shows the mode switch on a sermon', async () => {

      await runScenarios(
        [
          {
            name: 'displays the mode switch on the sermon page',
            run: () => {
              pathnameMock = '/sermons/test-sermon-id';
              render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
              expect(screen.getByText('Mode Toggle')).toBeInTheDocument();
            }
          },
          // Only sermon root should show toggle
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });

    it('shows it only on the sermon itself', async () => {

      await runScenarios(
        [
          {
            name: 'shows the mode switch on the sermon page',
            run: () => {
              pathnameMock = '/sermons/test-sermon-id';
              render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );

              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
              expect(screen.getByText('Mode Toggle')).toBeInTheDocument();
            }
          },
          {
            name: 'shows only on the sermon page itself',
            run: () => {
              pathnameMock = '/sermons/test-id';
              render(
                <TestProviders>
                  <DashboardNav />
                </TestProviders>
              );
              expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
              cleanup();

              pathnameMock = '/sermons/test-id/plan';
              render(
                <TestProviders>
                  <DashboardNav />
                </TestProviders>
              );
              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
              cleanup();

              pathnameMock = '/structure';
              render(
                <TestProviders>
                  <DashboardNav />
                </TestProviders>
              );
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
              pathnameMock = '/dashboard';
              render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          },
          {
            name: 'hides toggle on series page even with access',
            run: () => {
              pathnameMock = '/series';
              render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          },
          {
            name: 'hides toggle on settings page even with access',
            run: () => {
              pathnameMock = '/settings';
              render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );

              expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
      );
    });
  });
});
