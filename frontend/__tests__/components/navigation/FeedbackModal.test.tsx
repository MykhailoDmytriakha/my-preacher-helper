import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FeedbackModal from '@/components/navigation/FeedbackModal';

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'feedback.title': 'Send Feedback'
      };
      return translations[key] || key;
    }
  })
}));

// Alternative mock for testing fallback values
const mockUseTranslationWithMissingKeys = () => ({
  t: (key: string) => {
    // Return undefined for feedback.title to test fallback
    if (key === 'feedback.title') return '';
    return key;
  }
});

// Mock FeedbackForm component
jest.mock('@/components/navigation/FeedbackForm', () => {
  return function MockFeedbackForm({ onSubmit, onCancel }: { onSubmit: any, onCancel: any }) {
    return (
      <div data-testid="feedback-form">
        <button onClick={() => onSubmit('Test feedback', 'suggestion')} data-testid="submit-button">
          Submit Feedback
        </button>
        <button onClick={onCancel} data-testid="cancel-button">
          Cancel
        </button>
      </div>
    );
  };
});

// IMPORTANT: Remove the FeedbackModal mock to test the actual component
// We're keeping FeedbackForm mock to simplify tests and avoid testing its internals here

describe('FeedbackModal Component', () => {
  const mockOnClose = jest.fn();
  const mockOnSubmit = jest.fn().mockResolvedValue(true);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders nothing when isOpen is false', () => {
    render(
      <FeedbackModal 
        isOpen={false} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('feedback-form')).not.toBeInTheDocument();
  });

  test('renders modal and form when isOpen is true', () => {
    render(
      <FeedbackModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    
    // Check for feedback form
    expect(screen.getByTestId('feedback-form')).toBeInTheDocument();
  });

  test('uses fallback title when translation is missing', () => {
    // Temporarily replace the mock implementation
    jest.spyOn(require('react-i18next'), 'useTranslation').mockImplementation(mockUseTranslationWithMissingKeys);
    
    render(
      <FeedbackModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    // Should use the fallback value "Send Feedback"
    expect(screen.getByText('Send Feedback')).toBeInTheDocument();
    
    // Restore the original mock
    jest.restoreAllMocks();
  });

  test('calls onClose when backdrop is clicked', () => {
    render(
      <FeedbackModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    // Find the backdrop element - it's a div with the 'bg-black bg-opacity-40' class
    // and has the onClick event handler
    const backdrop = screen.getByRole('dialog').querySelector('.bg-black.bg-opacity-40');
    expect(backdrop).toBeInTheDocument();
    
    // Click on the backdrop
    fireEvent.click(backdrop!);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test('calls onClose when close button is clicked', () => {
    render(
      <FeedbackModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    // Find the close button - it has an SVG child with the X icon
    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();
    
    // Click on the close button
    fireEvent.click(closeButton);
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  test('passes onSubmit to FeedbackForm', () => {
    render(
      <FeedbackModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    // Trigger the submit button in the mocked FeedbackForm
    fireEvent.click(screen.getByTestId('submit-button'));
    
    expect(mockOnSubmit).toHaveBeenCalledWith('Test feedback', 'suggestion');
  });

  test('passes onCancel to FeedbackForm', () => {
    render(
      <FeedbackModal 
        isOpen={true} 
        onClose={mockOnClose} 
        onSubmit={mockOnSubmit} 
      />
    );
    
    // Trigger the cancel button in the mocked FeedbackForm
    fireEvent.click(screen.getByTestId('cancel-button'));
    
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
}); 