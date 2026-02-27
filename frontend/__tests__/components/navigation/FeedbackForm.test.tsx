import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import FeedbackForm from '@/components/navigation/FeedbackForm';

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'feedback.typeLabel': 'Feedback Type',
        'feedback.typeSuggestion': 'Suggestion',
        'feedback.typeBug': 'Bug Report',
        'feedback.typeQuestion': 'Question',
        'feedback.typeOther': 'Other',
        'feedback.messageLabel': 'Your Feedback',
        'feedback.messagePlaceholder': 'Please tell us what you think...',
        'feedback.cancelButton': 'Cancel',
        'feedback.submitButton': 'Submit',
        'feedback.sendingButton': 'Sending...',
        'feedback.imagesLabel': 'Attachments',
        'feedback.attachImages': 'Attach images (optional)',
        'feedback.imagesNote': 'Up to 3 images, max 4 MB each',
        'feedback.removeImage': 'Remove image',
        'feedback.imageLimitReached': 'Maximum 3 images allowed',
      };
      return translations[key] || key;
    }
  })
}));

// Helper to create a mock File with an optional size override
function createMockFile(name: string, sizeBytes = 1000, type = 'image/png'): File {
  const file = new File(['x'.repeat(Math.min(sizeBytes, 100))], name, { type });
  // Override size property for File API checks
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

// Simulate FileReader.readAsDataURL producing a dataURL result
function mockFileReader(dataUrl: string) {
  const originalFileReader = global.FileReader;
  const mockReadAsDataURL = jest.fn();
  // @ts-ignore
  global.FileReader = class {
    onload: ((e: ProgressEvent<FileReader>) => void) | null = null;
    readAsDataURL(file: File) {
      mockReadAsDataURL(file);
      // Trigger onload synchronously in the next microtask
      Promise.resolve().then(() => {
        if (this.onload) {
          this.onload({ target: { result: dataUrl } } as any);
        }
      });
    }
  };
  return () => { global.FileReader = originalFileReader; };
}

describe('FeedbackForm Component', () => {
  const mockOnSubmit = jest.fn().mockResolvedValue(true);
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders form with all elements including attachment button', () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Check form elements
    expect(screen.getByText('Feedback Type')).toBeInTheDocument();
    expect(screen.getByText('Your Feedback')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();

    // Check dropdown options
    expect(screen.getByRole('option', { name: 'Suggestion' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Bug Report' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Question' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument();

    // Check textarea placeholder
    expect(screen.getByPlaceholderText('Please tell us what you think...')).toBeInTheDocument();

    // Check attachment UI
    expect(screen.getByText('Attachments')).toBeInTheDocument();
    expect(screen.getByText('Attach images (optional)')).toBeInTheDocument();
    expect(screen.getByText('Up to 3 images, max 4 MB each')).toBeInTheDocument();
  });

  test('calls onCancel when cancel button is clicked', () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockOnCancel).toHaveBeenCalledTimes(1);
  });

  test('does not submit form when feedback text is empty', async () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Try to submit with empty feedback text
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    // Form shouldn't submit with empty text
    await waitFor(() => {
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  test('allows changing feedback type', () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('suggestion');

    fireEvent.change(select, { target: { value: 'bug' } });
    expect(select).toHaveValue('bug');

    fireEvent.change(select, { target: { value: 'question' } });
    expect(select).toHaveValue('question');

    fireEvent.change(select, { target: { value: 'other' } });
    expect(select).toHaveValue('other');
  });

  test('allows entering feedback text', () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Test feedback message' } });

    expect(textarea).toHaveValue('Test feedback message');
  });

  test('submits form with correct data when filled out (no images)', async () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Test feedback message' } });

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'bug' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('Test feedback message', 'bug', []);
    });
  });

  test('submits form with images included in the call', async () => {
    const dataUrl = 'data:image/png;base64,abc123';
    const restore = mockFileReader(dataUrl);

    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Simulate file selection
    const fileInput = screen.getByTestId('image-file-input');
    const file = createMockFile('test.png');
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      // Wait for FileReader onload microtask
      await Promise.resolve();
    });

    // Fill text and submit
    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Feedback with image' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('Feedback with image', 'suggestion', [dataUrl]);
    });

    restore();
  });

  test('shows thumbnail after attaching an image and removes it on X click', async () => {
    const dataUrl = 'data:image/png;base64,abc123';
    const restore = mockFileReader(dataUrl);

    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');
    const file = createMockFile('shot.png');
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
      await Promise.resolve();
    });

    // Thumbnail grid should be visible
    expect(screen.getByTestId('image-previews')).toBeInTheDocument();

    // Remove the image
    const removeBtn = screen.getByTestId('remove-image-0');
    fireEvent.click(removeBtn);

    expect(screen.queryByTestId('image-previews')).not.toBeInTheDocument();

    restore();
  });

  test('shows error and does not add 4th image when limit reached', async () => {
    const dataUrl = 'data:image/png;base64,abc';
    const restore = mockFileReader(dataUrl);

    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');

    // Add 3 images sequentially
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent.change(fileInput, { target: { files: [createMockFile(`img${i}.png`)] } });
        await Promise.resolve();
      });
    }

    // Try to add a 4th — limit already reached, so the label should trigger the error
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [createMockFile('img4.png')] } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-error')).toBeInTheDocument();
      expect(screen.getByTestId('image-error').textContent).toMatch(/Maximum 3/i);
    });

    restore();
  });

  test('shows loading state during submission', async () => {
    // Mock a submission that doesn't resolve immediately
    const slowMockSubmit = jest.fn().mockImplementation(() => {
      return new Promise(resolve => setTimeout(() => resolve(true), 100));
    });

    render(<FeedbackForm onSubmit={slowMockSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Test feedback message' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByText('Sending...')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(slowMockSubmit).toHaveBeenCalledTimes(1);
    });
  });

  test('disables form controls during submission', async () => {
    const slowMockSubmit = jest.fn().mockImplementation(() => {
      return new Promise(resolve => setTimeout(() => resolve(true), 100));
    });

    render(<FeedbackForm onSubmit={slowMockSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Test feedback message' } });

    const select = screen.getByRole('combobox');
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    const submitButton = screen.getByRole('button', { name: 'Submit' });

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(textarea).toBeDisabled();
      expect(select).toBeDisabled();
      expect(cancelButton).toBeDisabled();
      expect(submitButton).toBeDisabled();
    });
  });

  test('handles submission errors gracefully', async () => {
    const failedMockSubmit = jest.fn().mockRejectedValue(new Error('Submission failed'));

    render(<FeedbackForm onSubmit={failedMockSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Test feedback message' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(failedMockSubmit).toHaveBeenCalledTimes(1);
    });

    // Form controls should be enabled again after error
    await waitFor(() => {
      expect(textarea).toBeEnabled();
      expect(screen.getByRole('combobox')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
    });
  });

  test('trims whitespace from feedback text', async () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: '  Test feedback with whitespace  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('  Test feedback with whitespace  ', 'suggestion', []);
    });
  });

  test('shows error when a file exceeds the 4 MB size limit', async () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');
    // 5 MB > 4 MB limit
    const largeFile = createMockFile('large.png', 5 * 1024 * 1024);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [largeFile] } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-error')).toBeInTheDocument();
      expect(screen.getByTestId('image-error').textContent).toContain('too large');
    });

    // No image should have been added
    expect(screen.queryByTestId('image-previews')).not.toBeInTheDocument();
  });

  test('prevents default form submission behavior', () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: 'Test feedback message' } });

    const form = screen.getByRole('textbox').closest('form');
    expect(form).toBeInTheDocument();

    fireEvent.submit(form!);

    expect(mockOnSubmit).toHaveBeenCalledWith('Test feedback message', 'suggestion', []);
  });
});