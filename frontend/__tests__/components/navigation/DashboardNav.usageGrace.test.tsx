import { render, screen } from '@testing-library/react';
import React from 'react';

import DashboardNav from '@/components/navigation/DashboardNav';

const mockControllerMount = jest.fn();
const mockIndicatorMount = jest.fn();
const mockUseShellPathname = jest.fn(() => '/dashboard');

jest.mock('@/components/usage/UsageGraceIndicator', () => ({
  UsageGraceController: ({ children }: { children: (model: unknown) => React.ReactNode }) => {
    mockControllerMount();
    return <>{children({ tone: 'warning', metrics: {} })}</>;
  },
  UsageGraceIndicator: ({ placement }: { placement: string }) => {
    mockIndicatorMount(placement);
    return <span data-testid={`usage-point-${placement}`} />;
  },
}));
jest.mock('@/hooks/useShellPathname', () => ({
  useShellPathname: () => mockUseShellPathname(),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn(() => null), toString: jest.fn(() => '') }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, handleLogout: jest.fn() }),
}));
jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: jest.fn(),
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: jest.fn(),
  }),
}));
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ hasAccess: true, loading: false }),
}));
jest.mock('@/services/userSettings.service', () => ({
  hasGroupsAccess: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/components/navigation/LanguageSwitcher', () => () => null);
jest.mock('@/components/navigation/UserProfileDropdown', () => () => null);
jest.mock('@/components/navigation/MobileMenu', () => () => null);
jest.mock('@/components/navigation/FeedbackModal', () => () => null);
jest.mock('@/components/navigation/OfflineIndicator', () => ({ OfflineIndicator: () => null }));
jest.mock('@locales/i18n', () => ({}));

describe('DashboardNav usage grace integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseShellPathname.mockReturnValue('/dashboard');
  });

  it('mounts one controller and renders desktop plus mobile passive points from it', () => {
    render(<DashboardNav />);

    expect(mockControllerMount).toHaveBeenCalledTimes(1);
    expect(mockIndicatorMount).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('usage-point-desktop')).toBeInTheDocument();
    expect(screen.getByTestId('usage-point-mobile')).toBeInTheDocument();
  });

  it('mounts neither controller nor indicators on the exact conduct route', () => {
    mockUseShellPathname.mockReturnValue('/groups/group-1/conduct');

    render(<DashboardNav />);

    expect(mockControllerMount).not.toHaveBeenCalled();
    expect(mockIndicatorMount).not.toHaveBeenCalled();
    expect(screen.queryByTestId('usage-point-desktop')).not.toBeInTheDocument();
    expect(screen.queryByTestId('usage-point-mobile')).not.toBeInTheDocument();
  });
});
