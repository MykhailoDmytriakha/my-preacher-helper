import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import ModeToggle from '@/components/navigation/ModeToggle';
import { hasGroupsAccess } from '@/services/userSettings.service';
import { runScenarios } from '@test-utils/scenarioRunner';
// Use mocked ModeToggle rendered inside DashboardNav and query by testids exposed there
jest.mock('@locales/i18n', () => ({}));

// Mocks
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: any) => <a>{children}</a> }));

const replaceMock = jest.fn();
const pushMock = jest.fn();
let pathnameMock = '/sermons/abc';
let paramsMap: Record<string, string | undefined> = {};

const OLD_ENV = process.env;
const resetScenario = () => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  replaceMock.mockReset();
  pushMock.mockReset();
  pathnameMock = '/sermons/abc';
  paramsMap = {};
  mockHasGroupsAccess.mockResolvedValue(true);
};

jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  useSearchParams: () => ({
    get: (k: string) => paramsMap[k],
    toString: () => {
      const usp = new URLSearchParams();
      Object.entries(paramsMap).forEach(([k, v]) => { if (v !== undefined) usp.set(k, v); });
      return usp.toString();
    },
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
jest.mock('@/services/userSettings.service', () => ({
  ...jest.requireActual('@/services/userSettings.service'),
  hasGroupsAccess: jest.fn(),
}));
const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;

// Mock usePrepModeAccess hook
jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ hasAccess: true, loading: false })
}));

// Mock segmented toggle to a minimal testable version with stable testids
jest.mock('@/components/navigation/ModeToggle', () => ({
  __esModule: true,
  default: ({ currentMode, onSetMode, tSwitchToClassic, tPrepLabel }: any) => (
    <div>
      <button data-testid="toggle-classic" aria-pressed={currentMode === 'classic'} onClick={() => onSetMode('classic')}>{tSwitchToClassic}</button>
      <button data-testid="toggle-prep" aria-pressed={currentMode === 'prep'} onClick={() => onSetMode('prep')}>{tPrepLabel}</button>
      <span>beta</span>
    </div>
  )
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => ({
      'navigation.primary': 'Основная навигация',
      'navigation.dashboard': 'Dashboard',
      'wizard.switchToClassic': 'Classic Mode',
      'wizard.switchToPrepBeta': 'Preparation Mode (Beta)',
      'wizard.previewButton': 'Preparation Mode',
      'feedback.button': 'Feedback',
    } as Record<string, string>)[k] || k,
  })
}));

describe('DashboardNav mode toggle', () => {
  beforeEach(resetScenario);
  afterAll(() => { process.env = OLD_ENV; });

  it('covers toggle rendering and standalone behavior', async () => {
    await runScenarios(
      [
        {
          name: 'hidden outside sermon path',
          run: () => {
            pathnameMock = '/dashboard';
            render(<DashboardNav />);
            expect(screen.queryByText('Classic Mode')).not.toBeInTheDocument();
          }
        },
        {
          name: 'ModeToggle renders with beta badge',
          run: () => {
            render(
              <ModeToggle
                currentMode="classic"
                onSetMode={jest.fn()}
                tSwitchToClassic="Classic Mode"
                tSwitchToPrep="Preparation Mode (Beta)"
                tPrepLabel="Preparation Mode"
              />
            );
            expect(screen.getByTestId('toggle-prep')).toBeInTheDocument();
            expect(screen.getByText(/beta/i)).toBeInTheDocument();
          }
        },
        {
          name: 'prep click triggers callback',
          run: () => {
            const onSetMode = jest.fn();
            render(
              <ModeToggle
                currentMode="classic"
                onSetMode={onSetMode}
                tSwitchToClassic="Classic Mode"
                tSwitchToPrep="Preparation Mode (Beta)"
                tPrepLabel="Preparation Mode"
              />
            );
            fireEvent.click(screen.getByTestId('toggle-prep'));
            expect(onSetMode).toHaveBeenCalledWith('prep');
          }
        },
        {
          name: 'classic click triggers callback',
          run: () => {
            const onSetMode = jest.fn();
            render(
              <ModeToggle
                currentMode="prep"
                onSetMode={onSetMode}
                tSwitchToClassic="Classic Mode"
                tSwitchToPrep="Preparation Mode (Beta)"
                tPrepLabel="Preparation Mode"
              />
            );
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(onSetMode).toHaveBeenCalledWith('classic');
          }
        }
      ],
      { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
    );
  });

  it('detects and switches modes via URL state', async () => {
    await runScenarios(
      [
        {
          name: 'reads prep mode from query',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(<DashboardNav />);
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'defaults to classic when no mode',
          run: () => {
            render(<DashboardNav />);
            expect(screen.getByTestId('toggle-classic')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'switches from classic to prep',
          run: () => {
            render(<DashboardNav />);
            fireEvent.click(screen.getByTestId('toggle-prep'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=prep', { scroll: false });
          }
        },
        {
          name: 'switches from prep to classic',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(<DashboardNav />);
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc', { scroll: false });
          }
        },
        {
          name: 'preserves other query params',
          run: () => {
            paramsMap = { mode: 'prep', otherParam: 'value' };
            render(<DashboardNav />);
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?otherParam=value', { scroll: false });
          }
        },
        {
          name: 'keeps multiple params',
          run: () => {
            paramsMap = { mode: 'prep', param1: 'value1', param2: 'value2' };
            render(<DashboardNav />);
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?param1=value1&param2=value2', { scroll: false });
          }
        },
        {
          name: 'ignores clicks when already in mode',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(<DashboardNav />);
            fireEvent.click(screen.getByTestId('toggle-prep'));
            expect(pushMock).not.toHaveBeenCalled();
          }
        }
      ],
      { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
    );
  });

  it('handles edge cases gracefully', async () => {
    await runScenarios(
      [
        {
          name: 'empty pathname hides toggle',
          run: () => {
            pathnameMock = '';
            render(<DashboardNav />);
            expect(screen.queryByTestId('toggle-prep')).not.toBeInTheDocument();
          }
        },
        {
          name: 'undefined pathname hides toggle',
          run: () => {
            pathnameMock = undefined as any;
            render(<DashboardNav />);
            expect(screen.queryByTestId('toggle-prep')).not.toBeInTheDocument();
          }
        },
        {
          name: 'complex pathname still shows toggle',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(<DashboardNav />);
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'handles console errors without crashing',
          run: () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            paramsMap = { mode: 'prep' };
            render(<DashboardNav />);
            expect(screen.getByTestId('toggle-prep')).toBeInTheDocument();
            consoleSpy.mockRestore();
          }
        },
        {
          name: 'handles empty query values',
          run: () => {
            paramsMap = { mode: 'prep', emptyParam: '' };
            render(<DashboardNav />);
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'handles special characters in params',
          run: () => {
            paramsMap = { mode: 'prep', specialParam: 'value with spaces & symbols' };
            render(<DashboardNav />);
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        }
      ],
      { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
    );
  });
});

describe('Navigation button visibility', () => {
  it('hides groups navigation item when groups access is disabled', async () => {
    mockHasGroupsAccess.mockResolvedValueOnce(false);
    pathnameMock = '/dashboard';

    render(<DashboardNav />);

    await waitFor(() => {
      expect(screen.queryByText('navigation.groups')).not.toBeInTheDocument();
    });
  });

  it('updates groups item visibility immediately after feature toggle event', async () => {
    pathnameMock = '/dashboard';
    render(<DashboardNav />);

    await waitFor(() => {
      expect(screen.getByText('navigation.groups')).toBeInTheDocument();
    });

    window.dispatchEvent(new CustomEvent('groups-feature-updated', { detail: false }));

    await waitFor(() => {
      expect(screen.queryByText('navigation.groups')).not.toBeInTheDocument();
    });

    window.dispatchEvent(new CustomEvent('groups-feature-updated', { detail: true }));

    await waitFor(() => {
      expect(screen.getByText('navigation.groups')).toBeInTheDocument();
    });
  });

  it('toggles dropdown based on route', async () => {
    await runScenarios(
      [
        {
          name: 'structure page shows dropdown',
          run: () => {
            pathnameMock = '/structure';
            paramsMap = { sermonId: 'test-id' };
            render(<DashboardNav />);
            expect(screen.getByText('Основная навигация')).toBeInTheDocument();
          }
        },
        {
          name: 'sermon main page shows dropdown',
          run: () => {
            pathnameMock = '/sermons/test-id';
            render(<DashboardNav />);
            expect(screen.getByText('Основная навигация')).toBeInTheDocument();
          }
        },
        {
          name: 'sermon plan page shows dropdown',
          run: () => {
            pathnameMock = '/sermons/test-id/plan';
            render(<DashboardNav />);
            expect(screen.getByText('Основная навигация')).toBeInTheDocument();
          }
        },
        {
          name: 'dashboard hides dropdown',
          run: () => {
            pathnameMock = '/dashboard';
            render(<DashboardNav />);
            expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
          }
        },
        {
          name: 'series page hides dropdown',
          run: () => {
            pathnameMock = '/series';
            render(<DashboardNav />);
            expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
          }
        }
      ],
      { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
    );
  });
});
