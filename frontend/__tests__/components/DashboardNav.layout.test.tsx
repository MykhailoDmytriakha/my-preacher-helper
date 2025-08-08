import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
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

jest.mock('@/components/navigation/LanguageSwitcher', () => () => <div/>);
jest.mock('@/components/navigation/UserProfileDropdown', () => () => <div/>);
jest.mock('@/components/navigation/MobileMenu', () => () => <div/>);
jest.mock('@/components/navigation/FeedbackModal', () => () => <div/>);

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
});


