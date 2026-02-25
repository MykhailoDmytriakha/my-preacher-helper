import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => '/dashboard'),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: jest.fn(() => ({ get: jest.fn(() => null), toString: jest.fn(() => '') })),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => (k === 'feedback.button' ? 'Feedback' : 'Dashboard') })
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, handleLogout: jest.fn() })
}));

jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: jest.fn(),
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: jest.fn(),
  })
}));

jest.mock('@/components/navigation/LanguageSwitcher', () => () => <div />);
jest.mock('@/components/navigation/UserProfileDropdown', () => () => <div />);
jest.mock('@/components/navigation/MobileMenu', () => () => <div />);
jest.mock('@/components/navigation/FeedbackModal', () => () => <div />);

jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ hasAccess: true, loading: false })
}));

describe('DashboardNav layout', () => {
  it('uses fluid container without max-w-7xl', () => {
    render(<DashboardNav />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    const wrapper = nav.querySelector(':scope > div');
    expect(wrapper).toBeTruthy();
    if (wrapper) {
      expect(wrapper.className).not.toMatch(/max-w-7xl/);
      expect(wrapper.className).toMatch(/px-4/);
      expect(wrapper.className).toMatch(/sm:px-6/);
      expect(wrapper.className).toMatch(/lg:px-8/);
    }
  });

  it('centers the ModeToggle when on a sermon page', () => {
    // Override usePathname specifically for this test
    const { usePathname } = require('next/navigation');
    usePathname.mockReturnValue('/sermons/123');

    // We already mocked usePrepModeAccess at the top level
    render(<DashboardNav />);

    // Desktop wrapper must be relative
    const desktopWrapper = screen.getByRole('navigation').querySelector('.lg\\:flex.h-16');
    expect(desktopWrapper).toHaveClass('relative');

    // The ModeToggle should be wrapped in an absolute container
    // Let's find the button or visual element that has "Feedback" or something else to locate
    // Actually, mode toggle has some strings based on translations... "wizard.switchToClassic" or similar
    // We can just find the absolute container directly
    const modeToggleContainer = desktopWrapper?.querySelector('.absolute.left-1\\/2');
    expect(modeToggleContainer).toBeInTheDocument();
    expect(modeToggleContainer).toHaveClass('-translate-x-1/2');
    expect(modeToggleContainer).toHaveClass('-translate-y-1/2');
  });
});


