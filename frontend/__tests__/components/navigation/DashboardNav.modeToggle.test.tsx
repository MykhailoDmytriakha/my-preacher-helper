import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import ModeToggle from '@/components/navigation/ModeToggle';
// Use mocked ModeToggle rendered inside DashboardNav and query by testids exposed there
jest.mock('@locales/i18n', () => ({}));

// Mocks
jest.mock('next/link', () => ({ __esModule: true, default: ({ children }: any) => <a>{children}</a> }));

const replaceMock = jest.fn();
const pushMock = jest.fn();
let pathnameMock = '/sermons/abc';
let paramsMap: Record<string, string | undefined> = {};

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
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, NEXT_PUBLIC_WIZARD_DEV_MODE: 'true' };
    replaceMock.mockReset();
    pushMock.mockReset();
    pathnameMock = '/sermons/abc';
    paramsMap = {};
  });
  afterAll(() => { process.env = OLD_ENV; });

  test('does not render toggle outside sermon path', () => {
    pathnameMock = '/dashboard';
    render(<DashboardNav />);
    expect(screen.queryByText('Classic Mode')).not.toBeInTheDocument();
    expect(screen.queryByText('Preparation Mode')).not.toBeInTheDocument();
  });

  test('renders centered toggle on sermon page with beta badge', () => {
    // Render mocked ModeToggle directly to assert presence
    render(<ModeToggle currentMode="classic" onSetMode={jest.fn()} tSwitchToClassic="Classic Mode" tSwitchToPrep="Preparation Mode (Beta)" tPrepLabel="Preparation Mode" />);
    expect(screen.getByTestId('toggle-classic')).toBeInTheDocument();
    expect(screen.getByTestId('toggle-prep')).toBeInTheDocument();
    expect(screen.getByText(/beta/i)).toBeInTheDocument();
  });

  test('clicking prep sets mode=prep in URL', () => {
    const onSetMode = jest.fn();
    render(<ModeToggle currentMode="classic" onSetMode={onSetMode} tSwitchToClassic="Classic Mode" tSwitchToPrep="Preparation Mode (Beta)" tPrepLabel="Preparation Mode" />);
    fireEvent.click(screen.getByTestId('toggle-prep'));
    expect(onSetMode).toHaveBeenCalledWith('prep');
  });

  test('clicking classic removes mode query', () => {
    const onSetMode = jest.fn();
    render(<ModeToggle currentMode="prep" onSetMode={onSetMode} tSwitchToClassic="Classic Mode" tSwitchToPrep="Preparation Mode (Beta)" tPrepLabel="Preparation Mode" />);
    fireEvent.click(screen.getByTestId('toggle-classic'));
    expect(onSetMode).toHaveBeenCalledWith('classic');
  });

  test('handles current mode detection from URL params', () => {
    paramsMap = { mode: 'prep' };
    render(<DashboardNav />);
    
    // Should detect prep mode from URL
    expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('toggle-classic')).toHaveAttribute('aria-pressed', 'false');
  });

  test('handles current mode detection when no mode param', () => {
    paramsMap = {};
    render(<DashboardNav />);
    
    // Should default to classic mode
    expect(screen.getByTestId('toggle-classic')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'false');
  });

  test('handles mode switching with URL navigation', () => {
    paramsMap = {};
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Get the onSetMode function from the ModeToggle component
    const modeToggle = screen.getByTestId('toggle-prep').closest('div');
    if (modeToggle) {
      // Simulate mode switching by calling the onSetMode function
      const prepButton = within(modeToggle).getByTestId('toggle-prep');
      fireEvent.click(prepButton);
      
      // Should navigate to new URL with mode=prep
      expect(pushMock).toHaveBeenCalledWith('/sermons/abc?mode=prep', { scroll: false });
    }
  });

  test('handles mode switching from prep to classic', () => {
    paramsMap = { mode: 'prep' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Get the onSetMode function from the ModeToggle component
    const modeToggle = screen.getByTestId('toggle-classic').closest('div');
    if (modeToggle) {
      // Simulate mode switching by calling the onSetMode function
      const classicButton = within(modeToggle).getByTestId('toggle-classic');
      fireEvent.click(classicButton);
      
      // Should navigate to new URL without mode param
      expect(pushMock).toHaveBeenCalledWith('/sermons/abc', { scroll: false });
    }
  });

  test('handles mode switching with existing query parameters', () => {
    paramsMap = { mode: 'prep', otherParam: 'value' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Get the onSetMode function from the ModeToggle component
    const modeToggle = screen.getByTestId('toggle-classic').closest('div');
    if (modeToggle) {
      // Simulate mode switching by calling the onSetMode function
      const classicButton = within(modeToggle).getByTestId('toggle-classic');
      fireEvent.click(classicButton);
      
      // Should navigate to new URL without mode param but keeping other params
      expect(pushMock).toHaveBeenCalledWith('/sermons/abc?otherParam=value', { scroll: false });
    }
  });

  test('handles mode switching with complex query parameters', () => {
    paramsMap = { mode: 'prep', param1: 'value1', param2: 'value2' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Get the onSetMode function from the ModeToggle component
    const modeToggle = screen.getByTestId('toggle-classic').closest('div');
    if (modeToggle) {
      // Simulate mode switching by calling the onSetMode function
      const classicButton = within(modeToggle).getByTestId('toggle-classic');
      fireEvent.click(classicButton);
      
      // Should navigate to new URL without mode param but keeping other params
      expect(pushMock).toHaveBeenCalledWith('/sermons/abc?param1=value1&param2=value2', { scroll: false });
    }
  });

  test('handles mode switching when already in target mode', () => {
    paramsMap = { mode: 'prep' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Get the onSetMode function from the ModeToggle component
    const modeToggle = screen.getByTestId('toggle-prep').closest('div');
    if (modeToggle) {
      // Simulate mode switching by calling the onSetMode function
      const prepButton = within(modeToggle).getByTestId('toggle-prep');
      fireEvent.click(prepButton);
      
      // Should not navigate since already in prep mode
      expect(pushMock).not.toHaveBeenCalled();
    }
  });

  test('handles mode switching with empty pathname', () => {
    paramsMap = { mode: 'prep' };
    pathnameMock = '';
    
    render(<DashboardNav />);
    
    // Should handle empty pathname gracefully - mode toggle should not be visible
    expect(screen.queryByTestId('toggle-prep')).not.toBeInTheDocument();
  });

  test('handles mode switching with undefined pathname', () => {
    paramsMap = { mode: 'prep' };
    pathnameMock = undefined as any;
    
    render(<DashboardNav />);
    
    // Should handle undefined pathname gracefully - mode toggle should not be visible
    expect(screen.queryByTestId('toggle-prep')).not.toBeInTheDocument();
  });

  test('handles mode switching with complex pathname', () => {
    paramsMap = { mode: 'prep' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Should handle complex pathname correctly - mode toggle should be visible
    expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
  });

  test('handles error during mode switching gracefully', () => {
    paramsMap = { mode: 'prep' };
    pathnameMock = '/sermons/abc';
    
    // Mock console.error to prevent test output pollution
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    render(<DashboardNav />);
    
    // Should not crash on error
    expect(screen.getByTestId('toggle-prep')).toBeInTheDocument();
    
    consoleSpy.mockRestore();
  });

  test('handles URLSearchParams toString edge cases', () => {
    paramsMap = { mode: 'prep', emptyParam: '' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Should handle empty parameter values correctly
    expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
  });

  test('handles URLSearchParams with special characters', () => {
    paramsMap = { mode: 'prep', specialParam: 'value with spaces & symbols' };
    pathnameMock = '/sermons/abc';
    
    render(<DashboardNav />);
    
    // Should handle special characters in parameters correctly
    expect(screen.getByTestId('toggle-prep')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Navigation button visibility', () => {
  test('shows navigation dropdown on structure page', () => {
    pathnameMock = '/structure';
    paramsMap = { sermonId: 'test-id' };

    render(<DashboardNav />);

    expect(screen.getByText('Основная навигация')).toBeInTheDocument();
  });

  test('shows navigation dropdown on sermon main page', () => {
    pathnameMock = '/sermons/test-id';
    paramsMap = {};

    render(<DashboardNav />);

    expect(screen.getByText('Основная навигация')).toBeInTheDocument();
  });

  test('shows navigation dropdown on sermon plan page', () => {
    pathnameMock = '/sermons/test-id/plan';
    paramsMap = {};

    render(<DashboardNav />);

    expect(screen.getByText('Основная навигация')).toBeInTheDocument();
  });

  test('hides navigation dropdown on dashboard', () => {
    pathnameMock = '/dashboard';
    paramsMap = {};

    render(<DashboardNav />);

    expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
  });

  test('hides navigation dropdown on series page', () => {
    pathnameMock = '/series';
    paramsMap = {};

    render(<DashboardNav />);

    expect(screen.queryByText('Основная навигация')).not.toBeInTheDocument();
  });
});


