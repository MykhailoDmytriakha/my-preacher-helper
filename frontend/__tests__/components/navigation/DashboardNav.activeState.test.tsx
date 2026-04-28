import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import { hasGroupsAccess } from '@/services/userSettings.service';
import { TestProviders } from '../../../test-utils/test-providers';

jest.mock('@locales/i18n', () => ({}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let pathnameMock = '/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({
    get: () => undefined,
    toString: () => '',
  }),
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'test@example.com' }, handleLogout: jest.fn() }),
}));

jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: jest.fn(),
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: jest.fn(),
  }),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ hasAccess: false, loading: false }),
}));

jest.mock('@/components/navigation/LanguageSwitcher', () => ({
  __esModule: true,
  default: () => <div data-testid="lang-switch" />,
}));

jest.mock('@/components/navigation/UserProfileDropdown', () => ({
  __esModule: true,
  default: () => <div data-testid="user-dropdown" />,
}));

jest.mock('@/components/navigation/FeedbackModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/navigation/MobileMenu', () => ({
  __esModule: true,
  default: () => <div data-testid="mobile-menu" />,
}));

jest.mock('@/components/navigation/ModeToggle', () => ({
  __esModule: true,
  default: () => <div data-testid="mode-toggle" />,
}));

jest.mock('@/services/userSettings.service', () => ({
  ...jest.requireActual('@/services/userSettings.service'),
  hasGroupsAccess: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => ({
      'navigation.appName': 'Помощник проповедника',
      'navigation.primary': 'Основная навигация',
      'navigation.dashboard': 'Панель',
      'navigation.sermons': 'Проповеди',
      'navigation.series': 'Серии',
      'navigation.studies': 'Изучения',
      'navigation.groups': 'Группы',
      'navigation.prayer': 'Молитвы',
      'navigation.calendar': 'Календарь',
      'navigation.settings': 'Настройки',
      'feedback.button': 'Обратная связь',
    } as Record<string, string>)[key] ?? options?.defaultValue ?? key,
  }),
}));

const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;

describe('DashboardNav active state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pathnameMock = '/dashboard';
    mockHasGroupsAccess.mockResolvedValue(true);
  });

  it('marks the dashboard nav item active on /dashboard instead of sermons', () => {
    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );

    const activeLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page');

    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveTextContent('Панель');
    expect(screen.getByRole('link', { name: /Проповеди/ })).not.toHaveAttribute('aria-current');
  });
});
