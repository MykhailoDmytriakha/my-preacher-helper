import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';
import { useTranslation } from 'react-i18next';

import LanguageSwitcher from '@/components/navigation/LanguageSwitcher';
import { useAuth } from '@/hooks/useAuth';
import { updateUserLanguage } from '@/services/userSettings.service';

// Mock the dependencies
jest.mock('react-i18next', () => ({
  useTranslation: jest.fn()
}));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: jest.fn()
}));

jest.mock('@/services/userSettings.service', () => ({
  updateUserLanguage: jest.fn()
}));

describe('LanguageSwitcher Component', () => {
  // Mock data and functions
  const mockChangeLanguage = jest.fn();
  const mockUser = { uid: 'test-user-id' };
  const mockUpdateUserLanguage = updateUserLanguage as jest.Mock;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    (useTranslation as jest.Mock).mockReturnValue({
      i18n: {
        language: 'en',
        changeLanguage: mockChangeLanguage
      }
    });
    
    (useAuth as jest.Mock).mockReturnValue({
      user: mockUser
    });
    
    mockUpdateUserLanguage.mockResolvedValue(undefined);
    
    // Mock document events
    document.addEventListener = jest.fn();
    document.removeEventListener = jest.fn();
    
    // Mock container ref contains method
    Element.prototype.contains = jest.fn().mockImplementation(() => false);
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });
  
  test('renders with the correct language button', () => {
    render(<LanguageSwitcher />);
    
    // Check if the button is rendered with the globe icon
    const button = screen.getByRole('button', { name: /change language/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', 'English');
    expect(screen.getByText('🌐')).toBeInTheDocument();
  });
  
  test('dropdown is initially closed', () => {
    render(<LanguageSwitcher />);
    
    // Check dropdown is not visible initially
    expect(screen.queryByText('English')).not.toBeInTheDocument();
    expect(screen.queryByText('Русский')).not.toBeInTheDocument();
    expect(screen.queryByText('Українська')).not.toBeInTheDocument();
  });
  
  test('opens dropdown when button is clicked', () => {
    render(<LanguageSwitcher />);
    
    // Click the language button
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Check dropdown is visible with all languages
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Русский')).toBeInTheDocument();
    expect(screen.getByText('Українська')).toBeInTheDocument();
  });
  
  test('shows selected language with checkmark', () => {
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // The English option should have an SVG checkmark since it's the current language
    const englishButton = screen.getByText('English').closest('button');
    expect(englishButton).toHaveClass('bg-blue-50');
    expect(englishButton?.querySelector('svg')).toBeInTheDocument();
    
    // Other languages shouldn't have a checkmark
    const russianButton = screen.getByText('Русский').closest('button');
    expect(russianButton).not.toHaveClass('bg-blue-50');
    expect(russianButton?.querySelector('svg')).not.toBeInTheDocument();
  });
  
  test('changes language when a language option is clicked', async () => {
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Click on Russian language option
    fireEvent.click(screen.getByText('Русский'));
    
    // Check if changeLanguage was called with correct argument
    expect(mockChangeLanguage).toHaveBeenCalledWith('ru');
    
    // Check if updateUserLanguage was called with correct arguments
    expect(mockUpdateUserLanguage).toHaveBeenCalledWith('test-user-id', 'ru');
    
    // Dropdown should be closed after selection
    await waitFor(() => {
      expect(screen.queryByText('Русский')).not.toBeInTheDocument();
    });
  });
  
  test('changes language for guest users', async () => {
    // Set up user as null (guest)
    (useAuth as jest.Mock).mockReturnValue({
      user: null
    });
    
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Click on Ukrainian language option
    fireEvent.click(screen.getByText('Українська'));
    
    // Check if changeLanguage was called with correct argument
    expect(mockChangeLanguage).toHaveBeenCalledWith('uk');
    
    // Check if updateUserLanguage was called with empty string for uid
    expect(mockUpdateUserLanguage).toHaveBeenCalledWith('', 'uk');
  });
  
  test('adds event listener when dropdown is open', () => {
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Check that event listener was added
    expect(document.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });
  
  test('removes event listener when dropdown is closed', () => {
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Close dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Check that event listener was removed
    expect(document.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });
  
  test('closes dropdown when clicking outside', () => {
    // Mock the document.addEventListener to capture the click handler
    const addEventListenerSpy = jest.spyOn(document, 'addEventListener');
    const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
    
    // Mock contains to return false (click is outside)
    Element.prototype.contains = jest.fn().mockImplementation(() => false);
    
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Verify event listener was added
    expect(addEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    
    // Get the handler function that was registered
    const mousedownHandler = addEventListenerSpy.mock.calls.find(
      call => call[0] === 'mousedown'
    )?.[1] as EventListener;
    
    // Simulate a click outside
    mousedownHandler(new MouseEvent('mousedown', { bubbles: true }));
    
    // Verify event listener was removed (which happens when dropdown is closed)
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    
    // Clean up
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });
  
  test('doesnt close dropdown when clicking inside', () => {
    // Mock contains to return true (click is inside)
    Element.prototype.contains = jest.fn().mockImplementation(() => true);
    
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Simulate the click inside handler
    const handleClickOutsideCall = (document.addEventListener as jest.Mock).mock.calls.find(
      call => call[0] === 'mousedown'
    );
    
    if (handleClickOutsideCall) {
      const [, handler] = handleClickOutsideCall;
      // Simulate a click inside
      handler({ target: document.body });
      
      // Dropdown should stay open
      expect(screen.getByText('English')).toBeInTheDocument();
    }
  });
  
  test('handles error when updating language preference', async () => {
    // Mock console.error
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock updateUserLanguage to reject
    mockUpdateUserLanguage.mockRejectedValueOnce(new Error('Failed to update'));
    
    render(<LanguageSwitcher />);
    
    // Open dropdown
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Click on Russian language option
    fireEvent.click(screen.getByText('Русский'));
    
    // i18n.changeLanguage should still be called
    expect(mockChangeLanguage).toHaveBeenCalledWith('ru');
    
    // Wait for the error to be logged
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to update language preference:',
        expect.any(Error)
      );
    });
    
    consoleSpy.mockRestore();
  });
  
  test('uses first language as default when current language not found', () => {
    // Set a language that doesn't exist in supported languages
    (useTranslation as jest.Mock).mockReturnValue({
      i18n: {
        language: 'fr', // French is not in supported languages
        changeLanguage: mockChangeLanguage
      }
    });
    
    render(<LanguageSwitcher />);
    
    // The button should show English (first language) as title
    const button = screen.getByRole('button', { name: /change language/i });
    expect(button).toHaveAttribute('title', 'English');
  });
  
  test('cleanup removes event listener', () => {
    const { unmount } = render(<LanguageSwitcher />);
    
    // Open dropdown to add event listener
    fireEvent.click(screen.getByRole('button', { name: /change language/i }));
    
    // Unmount to trigger cleanup
    unmount();
    
    // Check if event listener was removed during cleanup
    expect(document.removeEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
  });
}); 