import { render, screen, waitFor } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import React from 'react';

import SettingsShell from '@/(pages)/(private)/settings/layout';
import LimitsPage from '@/(pages)/(private)/settings/limits/page';
import TagsPage from '@/(pages)/(private)/settings/tags/page';
import TemplatesPage from '@/(pages)/(private)/settings/templates/page';
import UserPage from '@/(pages)/(private)/settings/user/page';
import '@testing-library/jest-dom';
import { TestProviders } from '@test-utils/test-providers';

const authState: { user: unknown; loading: boolean } = {
  user: { uid: 'test-user', email: 'test@example.com', displayName: 'Test User' },
  loading: false,
};
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => authState,
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock child components
jest.mock('@/components/settings/UserSettingsSection', () => ({ user }: { user: any }) => (
  <div data-testid="user-settings-section">
    <h2>User Settings</h2>
    <p>User: {user?.email || 'No user'}</p>
  </div>
));
jest.mock('@/components/settings/ReferralCard', () => () => <div data-testid="referral-card">Referral</div>);
jest.mock('@/components/settings/TagsSection', () => ({ user }: { user: any }) => (
  <div data-testid="tags-section">
    <h2>Tags Management</h2>
    <p>User: {user?.email || 'No user'}</p>
  </div>
));
jest.mock('@/components/settings/PlanTemplatesSection', () => ({ user }: { user: any }) => (
  <div data-testid="plan-templates-section">User: {user?.email || 'No user'}</div>
));
jest.mock('@/components/settings/UsageWidget', () => () => <div data-testid="usage-widget">Usage</div>);
jest.mock('@/components/settings/ModelSelector', () => () => <div data-testid="model-selector">Models</div>);
jest.mock('@/components/settings/SettingsLayout', () => ({ children, title }: { children: React.ReactNode, title: string }) => (
  <div data-testid="settings-layout">
    <h1 role="heading" aria-level={1}>{title}</h1>
    {children}
  </div>
));
jest.mock('@components/settings/SettingsNav', () => ({ activeSection }: any) => (
  <nav data-testid="settings-nav" data-active={activeSection}>navigation</nav>
));

// The freshness layer is shared; here we only drive its OUTPUT, to prove this screen
// actually renders the pill when the document moved on elsewhere.
const mockFreshness = {
  state: 'fresh' as 'fresh' | 'stale' | 'unknown',
  remote: null as unknown,
  remotelyDeleted: false,
  markSynced: jest.fn(),
};
const freshnessCalls: Array<Record<string, unknown>> = [];
jest.mock('@/hooks/useDocumentFreshness', () => ({
  // ARGUMENTS ARE PART OF THE CONTRACT here: this screen holds no copy of the
  // settings document, so it must ask the hook to adopt the first server answer as
  // the baseline. A mock that swallows the options hides a dead pill behind a green
  // test — which is exactly what happened, and what live validation caught.
  useDocumentFreshness: (options: Record<string, unknown>) => {
    freshnessCalls.push(options);
    return mockFreshness;
  },
}));

jest.mock('@/components/navigation/LanguageInitializer', () => () => (
  <div data-testid="language-initializer">Language Initializer</div>
));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Interpolates `entity`, because that is exactly what makes the data pill say
    // WHICH thing changed — a mock that swallows it cannot tell the two pills apart.
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: { [key: string]: string } = {
        'settings.title': 'Settings',
        'settings.loading': 'Loading settings...',
        'settings.userSettings': 'User Settings',
        'settings.manageTags': 'Tags Management',
        'settings.nav.aiModels': 'AI & limits',
      };
      const text = translations[key] || key;
      return options?.entity ? `${text} [${String(options.entity)}]` : text;
    },
  }),
}));

const mockedUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

const renderShell = (pathname: string, children: React.ReactNode) => {
  mockedUsePathname.mockReturnValue(pathname);
  return render(<TestProviders><SettingsShell>{children}</SettingsShell></TestProviders>);
};

beforeEach(() => {
  jest.clearAllMocks();
  authState.user = { uid: 'test-user', email: 'test@example.com', displayName: 'Test User' };
  authState.loading = false;
  mockFreshness.state = 'fresh';
  mockFreshness.remote = null;
  freshnessCalls.length = 0;
});

/**
 * THE SHELL IS THE LAYOUT NOW, and that is the whole point of the change.
 *
 * Each section became a route of its own so a link could point AT one — "open plan
 * settings" used to land on whatever section the screen opened with. Chrome that must not
 * be rebuilt on every such link lives here, above the section: title, navigation, the
 * freshness pill, the admin check.
 */
describe('Settings shell', () => {
  it('frames the section with the title, the navigation and the language initializer', async () => {
    renderShell('/settings/user', <UserPage />);

    await waitFor(() => expect(screen.getByTestId('settings-layout')).toBeInTheDocument());
    expect(screen.getAllByRole('heading', { name: /Settings/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('language-initializer')).toBeInTheDocument();
    // One for the phone, one for the desktop sidebar — one content tree between them.
    expect(screen.getAllByTestId('settings-nav')).toHaveLength(2);
    expect(screen.getAllByTestId('user-settings-section')).toHaveLength(1);
  });

  it('tells the navigation which section the ADDRESS is on, not which one was clicked', async () => {
    renderShell('/settings/tags', <TagsPage />);

    await waitFor(() => expect(screen.getAllByTestId('settings-nav')).toHaveLength(2));
    screen.getAllByTestId('settings-nav').forEach((nav) => {
      expect(nav).toHaveAttribute('data-active', 'tags');
    });
  });

  it('falls back to the first section when the address names no section it knows', async () => {
    renderShell('/settings', <UserPage />);

    await waitFor(() => expect(screen.getAllByTestId('settings-nav')[0]).toHaveAttribute('data-active', 'user'));
  });

  it('shows the loading spinner while the account is still being decided', () => {
    authState.loading = true;
    renderShell('/settings/user', <UserPage />);

    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
    expect(screen.getByTestId('settings-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('user-settings-section')).not.toBeInTheDocument();
  });

  it('puts nothing of the person on screen when there is no account', () => {
    authState.user = null;
    const { container } = renderShell('/settings/user', <UserPage />);

    // Signing out is answered one layer up by ProtectedRoute; this screen simply says nothing.
    expect(container).toBeEmptyDOMElement();
  });
});

describe('Settings sections', () => {
  it('gives the user section the account it is describing', async () => {
    renderShell('/settings/user', <UserPage />);

    await waitFor(() => expect(screen.getByTestId('user-settings-section')).toHaveTextContent('User: test@example.com'));
    expect(screen.getByTestId('referral-card')).toBeInTheDocument();
  });

  it('shows usage and model selection on the limits section — the address the usage tooltip points at', async () => {
    renderShell('/settings/limits', <LimitsPage />);

    await waitFor(() => expect(screen.getByTestId('usage-widget')).toBeInTheDocument());
    expect(screen.getByTestId('model-selector')).toBeInTheDocument();
    expect(screen.queryByTestId('user-settings-section')).not.toBeInTheDocument();
  });

  it('shows tags on the tags section', async () => {
    renderShell('/settings/tags', <TagsPage />);

    await waitFor(() => expect(screen.getByTestId('tags-section')).toHaveTextContent('User: test@example.com'));
    expect(screen.queryByTestId('user-settings-section')).not.toBeInTheDocument();
  });

  it('shows structure templates on the templates section', async () => {
    renderShell('/settings/templates', <TemplatesPage />);

    await waitFor(() => expect(screen.getByTestId('plan-templates-section')).toHaveTextContent('User: test@example.com'));
  });
});

/**
 * SETTINGS WERE IN THE COVERAGE LIST WITH NOTHING AT ALL.
 *
 * A preference changed on the phone left this screen showing the old value, silently,
 * until a reload. Every toggle here writes the field it owns, so the screen quietly
 * disagreed with the server. The pill is the whole fix — nothing here is half-typed
 * text, so loading the newer values cannot destroy anything.
 */
describe('Settings freshness', () => {
  it('says nothing while the screen agrees with the server', async () => {
    renderShell('/settings/user', <UserPage />);

    await waitFor(() => expect(screen.getByTestId('settings-layout')).toBeInTheDocument());
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });

  it('asks the freshness layer to treat the first server answer as the baseline', async () => {
    // Without this the screen passes `known: null` forever, the hook can never call
    // anything stale, and the pill is dead while every unit test stays green.
    renderShell('/settings/user', <UserPage />);

    await waitFor(() => expect(freshnessCalls.length).toBeGreaterThan(0));
    const call = freshnessCalls[freshnessCalls.length - 1];
    expect(call.adoptFirstServerAnswerAsKnown).toBe(true);
    expect(call.collection).toBe('users');
  });

  it('shows the data pill — named for settings — when they changed elsewhere', async () => {
    mockFreshness.state = 'stale';
    mockFreshness.remote = { fields: 'newer' };

    renderShell('/settings/user', <UserPage />);

    await waitFor(() => expect(screen.getByText('freshness.title')).toBeInTheDocument());
    // The wording names the entity, so it cannot be confused with the app-update toast.
    expect(screen.getByRole('status')).toHaveTextContent('freshness.entitySettings');
  });

  it('keeps the pill across a change of section, because the shell is not rebuilt', async () => {
    mockFreshness.state = 'stale';
    mockFreshness.remote = { fields: 'newer' };
    mockedUsePathname.mockReturnValue('/settings/user');
    const { rerender } = render(<TestProviders><SettingsShell><UserPage /></SettingsShell></TestProviders>);

    await waitFor(() => expect(screen.getByText('freshness.title')).toBeInTheDocument());
    const callsBefore = freshnessCalls.length;

    mockedUsePathname.mockReturnValue('/settings/limits');
    rerender(<TestProviders><SettingsShell><LimitsPage /></SettingsShell></TestProviders>);

    expect(screen.getByText('freshness.title')).toBeInTheDocument();
    expect(screen.getByTestId('usage-widget')).toBeInTheDocument();
    // Re-rendered, not re-mounted: the listener was not torn down and set up again.
    expect(freshnessCalls.length).toBeGreaterThan(callsBefore);
  });
});
