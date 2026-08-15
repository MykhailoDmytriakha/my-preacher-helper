import { cleanup, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import ModeToggle from '@/components/navigation/ModeToggle';
import { hasGroupsAccess } from '@/services/userSettings.service';
import { runScenarios } from '@test-utils/scenarioRunner';
import { TestProviders } from '../../../test-utils/test-providers';
// Use mocked ModeToggle rendered inside DashboardNav and query by testids exposed there
jest.mock('@locales/i18n', () => ({}));

// Mocks
// Props are forwarded on purpose: the previous mock dropped href, aria-label and
// title, so every link rendered nameless and any assertion about the navigation's
// accessible names would have been testing the mock rather than the component.
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, prefetch: _prefetch, ...rest }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>
  ),
}));

const replaceMock = jest.fn();
const pushMock = jest.fn();
let pathnameMock = '/sermons/abc';
let paramsMap: Record<string, string | undefined> = {};
let mockPrepModeAccessState = { hasAccess: true, loading: false };

const OLD_ENV = process.env;
const resetScenario = () => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV };
  replaceMock.mockReset();
  pushMock.mockReset();
  pathnameMock = '/sermons/abc';
  paramsMap = {};
  mockPrepModeAccessState = { hasAccess: true, loading: false };
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

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'u1', email: 'test@user.com' }, handleLogout: jest.fn() }) }));
export const mockHandleSubmitFeedback = jest.fn().mockResolvedValue(true);
export const mockHandleFeedbackClick = jest.fn();
jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: mockHandleFeedbackClick,
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: mockHandleSubmitFeedback,
  })
}));
jest.mock('@/components/navigation/LanguageSwitcher', () => ({ __esModule: true, default: () => <div data-testid="lang-switch" /> }));
jest.mock('@/components/navigation/UserProfileDropdown', () => ({ __esModule: true, default: () => <div data-testid="user-dropdown" /> }));
jest.mock('@/components/navigation/FeedbackModal', () => ({ 
  __esModule: true, 
  default: ({ onSubmit }: any) => (
    <div data-testid="feedback-modal">
      <button data-testid="mock-feedback-submit" onClick={() => onSubmit('Test feedback', 'suggestion', ['img1'])}>Submit</button>
    </div>
  ) 
}));
jest.mock('@/components/navigation/MobileMenu', () => ({ __esModule: true, default: () => <div data-testid="mobile-menu" /> }));
jest.mock('@/services/userSettings.service', () => ({
  ...jest.requireActual('@/services/userSettings.service'),
  hasGroupsAccess: jest.fn(),
}));
const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;

// Mock usePrepModeAccess hook
jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ ...mockPrepModeAccessState })
}));

// Mock segmented toggle to a minimal testable version with stable testids
jest.mock('@/components/navigation/ModeToggle', () => ({
  __esModule: true,
  default: ({ currentMode, onSetMode, tSwitchToClassic, tPrepLabel, tRawLabel, canUsePrep = true }: any) => (
    <div>
      <button data-testid="toggle-classic" aria-pressed={currentMode === 'classic'} onClick={() => onSetMode('classic')}>{tSwitchToClassic}</button>
      <button data-testid="toggle-prep" aria-pressed={currentMode === 'prep'} disabled={!canUsePrep} onClick={() => onSetMode('prep')}>{tPrepLabel}</button>
      <button data-testid="toggle-raw" aria-pressed={currentMode === 'raw'} onClick={() => onSetMode('raw')}>{tRawLabel}</button>
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
      'wizard.modePrep': 'Preparation',
      'wizard.modeClassic': 'Classic',
      'wizard.modeRaw': 'Scratch',
      'wizard.switchToRaw': 'Scratch Notes',
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
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
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
                tRawLabel="Scratch"
              />
            );
            expect(screen.getByTestId('toggle-prep')).toBeInTheDocument();
            expect(screen.getByTestId('toggle-raw')).toBeInTheDocument();
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
                tRawLabel="Scratch"
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
                tRawLabel="Scratch"
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
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'reads raw mode from query',
          run: () => {
            paramsMap = { mode: 'raw' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-raw')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'defaults to classic when no mode',
          run: () => {
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-classic')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'switches from classic to prep',
          run: () => {
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            fireEvent.click(screen.getByTestId('toggle-prep'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=prep', { scroll: false });
          }
        },
        {
          name: 'switches from classic to raw',
          run: () => {
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            fireEvent.click(screen.getByTestId('toggle-raw'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=raw', { scroll: false });
          }
        },
        {
          name: 'switches from prep to classic',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=classic', { scroll: false });
          }
        },
        {
          name: 'preserves other query params',
          run: () => {
            paramsMap = { mode: 'prep', otherParam: 'value' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=classic&otherParam=value', { scroll: false });
          }
        },
        {
          name: 'keeps multiple params',
          run: () => {
            paramsMap = { mode: 'prep', param1: 'value1', param2: 'value2' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            fireEvent.click(screen.getByTestId('toggle-classic'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=classic&param1=value1&param2=value2', { scroll: false });
          }
        },
        {
          name: 'keeps classic and raw reachable when prep access is denied',
          run: () => {
            mockPrepModeAccessState = { hasAccess: false, loading: false };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-classic')).toBeInTheDocument();
            expect(screen.getByTestId('toggle-raw')).toBeInTheDocument();
            expect(screen.getByTestId('toggle-prep')).toBeDisabled();
            fireEvent.click(screen.getByTestId('toggle-raw'));
            expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=raw', { scroll: false });
          }
        },
        {
          name: 'ignores clicks when already in mode',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
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
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.queryByTestId('toggle-prep')).not.toBeInTheDocument();
          }
        },
        {
          name: 'undefined pathname hides toggle',
          run: () => {
            pathnameMock = undefined as any;
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.queryByTestId('toggle-prep')).not.toBeInTheDocument();
          }
        },
        {
          name: 'complex pathname still shows toggle',
          run: () => {
            paramsMap = { mode: 'prep' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'handles console errors without crashing',
          run: () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            paramsMap = { mode: 'prep' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-prep')).toBeInTheDocument();
            consoleSpy.mockRestore();
          }
        },
        {
          name: 'handles empty query values',
          run: () => {
            paramsMap = { mode: 'prep', emptyParam: '' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
          }
        },
        {
          name: 'handles special characters in params',
          run: () => {
            paramsMap = { mode: 'prep', specialParam: 'value with spaces & symbols' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
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

    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );

    await waitFor(() => {
      expect(screen.queryByText('navigation.groups')).not.toBeInTheDocument();
    });
  });

  it('updates groups item visibility immediately after feature toggle event', async () => {
    pathnameMock = '/dashboard';
    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );

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

  /**
   * Sermon pages get the SAME navigation, shrunk — not a different one.
   *
   * They used to hide it behind a "Navigation" dropdown, so moving from a sermon
   * to prayers took two clicks and one guess about where the sections went, while
   * every other page kept them one click away. The mode toggle needs the middle of
   * the bar, not the whole of it: dropping the labels frees enough room for the
   * icons to stay out in the open.
   *
   * jsdom applies no CSS, so "labels are hidden" is asserted the only honest way
   * here — the text node is not rendered at all in compact mode, while the
   * accessible name still carries it.
   */
  it('shrinks the nav on sermon pages instead of hiding it in a dropdown', async () => {
    const expectCompactNav = () => {
      // Scoped to the primary nav: the bar also renders a mobile row.
      const nav = within(screen.getByRole('list', { name: 'Основная навигация' }));
      expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
      expect(nav.getByRole('link', { name: 'navigation.sermons' })).toBeInTheDocument();
      expect(nav.queryByText('navigation.sermons')).not.toBeInTheDocument();
      // The wordmark is gone too: it linked to the dashboard, and so does the
      // first icon of this nav — one destination, one control. Counted within the
      // desktop row only: the mobile row carries its own logo and jsdom, having no
      // CSS, renders both.
      const desktopRow = within(screen.getByRole('list', { name: 'Основная навигация' }).parentElement!);
      expect(screen.queryByText('navigation.appName')).not.toBeInTheDocument();
      expect(desktopRow.getAllByRole('link', { name: 'Dashboard' })).toHaveLength(1);
    };

    await runScenarios(
      [
        {
          name: 'structure page shows the compact nav',
          run: () => {
            pathnameMock = '/structure';
            paramsMap = { sermonId: 'test-id' };
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expectCompactNav();
          }
        },
        {
          name: 'sermon main page shows the compact nav',
          run: () => {
            pathnameMock = '/sermons/test-id';
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expectCompactNav();
          }
        },
        {
          name: 'sermon plan page shows the compact nav',
          run: () => {
            pathnameMock = '/sermons/test-id/plan';
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            expectCompactNav();
          }
        },
        {
          name: 'dashboard keeps the labelled nav',
          run: () => {
            pathnameMock = '/dashboard';
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            const labelled = within(screen.getByRole('list', { name: 'Основная навигация' }));
            expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
            expect(labelled.getByText('navigation.sermons')).toBeInTheDocument();
          }
        },
        {
          name: 'series page keeps the labelled nav',
          run: () => {
            pathnameMock = '/series';
            render(
              <TestProviders>
                <DashboardNav />
              </TestProviders>
            );
            const labelled = within(screen.getByRole('list', { name: 'Основная навигация' }));
            expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
            expect(labelled.getByText('navigation.sermons')).toBeInTheDocument();
          }
        }
      ],
      { beforeEachScenario: resetScenario, afterEachScenario: cleanup }
    );
  });
});

describe('Feedback integration', () => {
  beforeEach(resetScenario);
  afterAll(() => { process.env = OLD_ENV; });

  it('calls handleSubmitFeedback without a client-supplied email', () => {
    pathnameMock = '/dashboard';
    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );
    
    // Simulate clicking the feedback button (desktop)
    const feedbackButton = screen.getAllByRole('button', { name: /Provide feedback/i })[0];
    fireEvent.click(feedbackButton);
    expect(mockHandleFeedbackClick).toHaveBeenCalled();

    // The FeedbackModal mock renders a submit button
    const submitBtn = screen.getByTestId('mock-feedback-submit');
    fireEvent.click(submitBtn);

    // Identity is derived from the bearer token by the endpoint.
    expect(mockHandleSubmitFeedback).toHaveBeenCalledWith(
      'Test feedback',
      'suggestion',
      ['img1'],
      'u1'
    );
  });
});

describe('DashboardNav useEffects', () => {
  beforeEach(resetScenario);
  afterAll(() => { process.env = OLD_ENV; });

  it('closes menus when pathname changes', () => {
    const { rerender } = render(<DashboardNav />, { wrapper: TestProviders });
    
    // Simulate mobile menu open
    const mobileMenuBtn = screen.getByRole('button', { name: /Open menu/i });
    fireEvent.click(mobileMenuBtn);
    
    // Change pathname
    pathnameMock = '/new-path';
    rerender(<DashboardNav />);
    
    expect(screen.getByRole('button', { name: /Open menu/i })).toBeInTheDocument();
  });

  it('keeps every section reachable in one click on a sermon page', () => {
    // Replaces the old "close the nav dropdown on outside click" test: there is no
    // dropdown any more, so nothing to open, close or click away from. What has to
    // hold instead is that the sections are all there, as links, without labels.
    pathnameMock = '/sermons/abc';
    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );

    expect(screen.queryByRole('button', { name: /Navigation menu/i })).not.toBeInTheDocument();
    const nav = within(screen.getByRole('list', { name: 'Основная навигация' }));
    expect(nav.getAllByRole('link').length).toBeGreaterThan(1);
    expect(nav.getByRole('link', { name: 'navigation.sermons' })).toBeInTheDocument();
  });
});
