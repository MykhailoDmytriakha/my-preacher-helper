import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoginOptions from '@/components/landing/LoginOptions';

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  GoogleIcon: () => <div data-testid="google-icon" />,
  UserIcon: () => <div data-testid="user-icon" />,
}));

// Mock the i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'loginOptions.heading': 'Get Started Now',
        'loginOptions.googleLogin': 'Continue with Google',
        'loginOptions.or': 'or',
        'loginOptions.guestLogin': 'Continue as Guest',
        'loginOptions.testLogin': 'Test Login (Dev Only)',
      };
      
      return translations[key] || key;
    },
  }),
}));

// Mock the process.env.NODE_ENV check used in the component
const originalNodeEnv = process.env.NODE_ENV;

describe('LoginOptions Component', () => {
  // Default props with mock functions
  const defaultProps = {
    onGoogleLogin: jest.fn(),
    onGuestLogin: jest.fn(),
    onTestLogin: jest.fn(),
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  it('renders the heading correctly', () => {
    render(<LoginOptions {...defaultProps} />);
    expect(screen.getByText('Get Started Now')).toBeInTheDocument();
  });
  
  it('renders the Google login button', () => {
    render(<LoginOptions {...defaultProps} />);
    
    // Check if button and text are rendered
    const googleButton = screen.getByText('Continue with Google').closest('button');
    expect(googleButton).toBeInTheDocument();
    
    // Check if icon is rendered
    const googleIcon = screen.getByTestId('google-icon');
    expect(googleIcon).toBeInTheDocument();
  });
  
  it('calls onGoogleLogin when Google button is clicked', () => {
    render(<LoginOptions {...defaultProps} />);
    
    // Find and click the Google login button
    const googleButton = screen.getByText('Continue with Google').closest('button');
    fireEvent.click(googleButton!);
    
    // Check if the onGoogleLogin function was called
    expect(defaultProps.onGoogleLogin).toHaveBeenCalledTimes(1);
  });
  
  // Since we can't directly modify NODE_ENV, we'll just test the component
  // as it behaves in the current environment
  it('conditionally renders test login button based on NODE_ENV', () => {
    const { rerender } = render(<LoginOptions {...defaultProps} />);
    
    // In test environment, the button should be rendered
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      expect(screen.getByText('Test Login (Dev Only)')).toBeInTheDocument();
    } else {
      expect(screen.queryByText('Test Login (Dev Only)')).not.toBeInTheDocument();
    }
  });
  
  it('calls onTestLogin when Test login button is clicked', () => {
    // Skip this test if not in development or test environment
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return;
    }
    
    render(<LoginOptions {...defaultProps} />);
    
    // Find and click the Test login button
    const testButton = screen.getByText('Test Login (Dev Only)');
    fireEvent.click(testButton);
    
    // Check if the onTestLogin function was called
    expect(defaultProps.onTestLogin).toHaveBeenCalledTimes(1);
  });
  
  it('has the expected styling for the container', () => {
    const { container } = render(<LoginOptions {...defaultProps} />);
    
    // Check if the container has the expected classes
    const mainContainer = container.firstChild;
    expect(mainContainer).toHaveClass('flex');
    expect(mainContainer).toHaveClass('flex-col');
    expect(mainContainer).toHaveClass('bg-white');
    expect(mainContainer).toHaveClass('dark:bg-gray-800');
    expect(mainContainer).toHaveClass('rounded-2xl');
  });
  
  it('renders buttons with their respective styling', () => {
    // Skip this test if not in development or test environment
    if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return;
    }
    
    render(<LoginOptions {...defaultProps} />);
    
    // Check Google button styling
    const googleButton = screen.getByText('Continue with Google').closest('button');
    expect(googleButton).toHaveClass('bg-gradient-to-r');
    expect(googleButton).toHaveClass('from-blue-200');
    expect(googleButton).toHaveClass('to-green-200');
    
    // Check Test button styling
    const testButton = screen.getByText('Test Login (Dev Only)').closest('button');
    expect(testButton).toHaveClass('bg-yellow-50');
    expect(testButton).toHaveClass('border-yellow-400');
  });
}); 