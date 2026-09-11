import { render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import { TestProviders } from '../../test-utils/test-providers';

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
    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );
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

  it('reserves a desktop grid column for the single responsive mode picker', () => {
    // Override usePathname specifically for this test
    const { usePathname } = require('next/navigation');
    usePathname.mockReturnValue('/sermons/123');

    // We already mocked usePrepModeAccess at the top level
    render(
      <TestProviders>
        <DashboardNav />
      </TestProviders>
    );

    const wrapper = screen.getByRole('navigation').querySelector(':scope > div');
    expect(wrapper).toHaveClass('lg:grid');
    expect(wrapper).toHaveClass('lg:grid-cols-[max-content_minmax(0,1fr)_max-content]');

    // In normal desktop flow the mode picker owns its column, so adjacent controls
    // cannot occupy the same space. Mobile placement uses the reserved title slot.
    const classicToggle = screen.getByTestId('toggle-classic');
    expect(screen.getAllByTestId('toggle-classic')).toHaveLength(1);
    const modeToggleContainer = classicToggle.closest('.lg\\:col-start-2');
    expect(modeToggleContainer).toBeInTheDocument();
    expect(modeToggleContainer).toHaveClass('lg:static', 'lg:row-start-1');
    expect(modeToggleContainer?.parentElement).toBe(wrapper);
    expect(wrapper?.querySelector('.lg\\:col-start-1')).toBeInTheDocument();
    expect(wrapper?.querySelector('.lg\\:col-start-3')).toBeInTheDocument();
  });
});
