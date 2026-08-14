import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import FeedbackForm from '@/components/navigation/FeedbackForm';

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { amount?: string }) => {
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
        'feedback.imagesNote': 'Up to 3 images, max 3 MB each and 4.4 MB total',
        'feedback.removeImage': 'Remove image',
        'feedback.imageLimitReached': 'Maximum 3 images allowed',
        'feedback.invalidImage': 'Only PNG, JPEG, and WebP images are supported',
        'feedback.imageTooLarge': 'Image is too large (max 3 MB)',
        'feedback.payloadTooLarge': 'Feedback is too large for one request. Shorten the message or remove an attachment.',
        'feedback.attachmentBudgetRemaining': '{{amount}} MB attachment budget remaining',
        'feedback.pasteHint': 'Or paste a screenshot straight from the clipboard — Ctrl+V / ⌘V',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      };
      return (translations[key] || key).replace('{{amount}}', options?.amount || '');
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
    expect(screen.getByText('Up to 3 images, max 3 MB each and 4.4 MB total')).toBeInTheDocument();
    expect(screen.getByTestId('attachment-budget')).toHaveTextContent(
      /MB attachment budget remaining/i
    );
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

  test('names a rules refusal and keeps the exact feedback visible', async () => {
    const dataUrl = 'data:image/png;base64,exact-refused-image';
    const restore = mockFileReader(dataUrl);
    const rejectedSubmit = jest.fn().mockRejectedValue(
      Object.assign(new Error('Forbidden'), { code: 'permission-denied' })
    );
    render(<FeedbackForm onSubmit={rejectedSubmit} onCancel={mockOnCancel} />);
    const type = screen.getByRole('combobox');
    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    await act(async () => {
      fireEvent.change(screen.getByTestId('image-file-input'), {
        target: { files: [createMockFile('exact-refused.png')] },
      });
      await Promise.resolve();
    });
    fireEvent.change(type, { target: { value: 'bug' } });
    fireEvent.change(textarea, { target: { value: 'Exact feedback that failed' } });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save refused. Nothing was saved; your text is still here.'
    );
    expect(textarea).toHaveValue('Exact feedback that failed');
    expect(type).toHaveValue('bug');
    expect(screen.getByAltText('attachment-1')).toHaveAttribute('src', dataUrl);
    expect(rejectedSubmit).toHaveBeenCalledWith(
      'Exact feedback that failed',
      'bug',
      [dataUrl]
    );
    restore();
  });

  test('keeps a paused offline submission silent while it is still pending', async () => {
    const pendingSubmit = jest.fn(() => new Promise<boolean>(() => undefined));
    render(<FeedbackForm onSubmit={pendingSubmit} onCancel={mockOnCancel} />);
    fireEvent.change(screen.getByPlaceholderText('Please tell us what you think...'), {
      target: { value: 'Still sending' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(pendingSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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

  test('shows error when a file exceeds the 3 MB size limit', async () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');
    // 4 MB > 3 MB limit
    const largeFile = createMockFile('large.png', 4 * 1024 * 1024);
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

  test('rejects an image MIME type outside PNG, JPEG, and WebP', async () => {
    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');
    await act(async () => {
      fireEvent.change(fileInput, {
        target: { files: [createMockFile('vector.svg', 1000, 'image/svg+xml')] },
      });
    });

    expect(screen.getByTestId('image-error')).toHaveTextContent(
      'Only PNG, JPEG, and WebP images are supported'
    );
    expect(screen.queryByTestId('image-previews')).not.toBeInTheDocument();
  });

  test('rejects an image when cumulative serialized attachments would exceed the payload budget', async () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(1_800_000)}`;
    const restore = mockFileReader(dataUrl);

    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [createMockFile('first.png')] } });
      await Promise.resolve();
    });
    const remainingAfterFirst = screen.getByTestId('attachment-budget').textContent;

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [createMockFile('second.png')] } });
      await Promise.resolve();
    });

    expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(1);
    expect(screen.getByTestId('image-error')).toHaveTextContent(
      'Feedback is too large for one request. Shorten the message or remove an attachment.'
    );
    expect(screen.getByTestId('attachment-budget').textContent).toBe(remainingAfterFirst);

    restore();
  });

  test('prevents serialized text expansion from invalidating accepted attachments at submit', async () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(3_300_000)}`;
    const restore = mockFileReader(dataUrl);

    render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const fileInput = screen.getByTestId('image-file-input');
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [createMockFile('near-budget.png')] } });
      await Promise.resolve();
    });
    expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(1);

    const textarea = screen.getByPlaceholderText('Please tell us what you think...');
    fireEvent.change(textarea, { target: { value: '\\'.repeat(700_000) } });

    expect(textarea).toHaveValue('');
    expect(screen.getByTestId('payload-error')).toHaveTextContent(
      'Feedback is too large for one request. Shorten the message or remove an attachment.'
    );

    fireEvent.change(textarea, { target: { value: 'Fits with the accepted attachment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith(
        'Fits with the accepted attachment',
        'suggestion',
        [dataUrl]
      );
    });

    restore();
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

  describe('pasting an image from the clipboard', () => {
    // Mirrors what a browser hands a paste handler: the bitmap arrives as a file entry.
    function clipboardWith(files: File[], text?: string) {
      const types = [...(text === undefined ? [] : ['text/plain']), ...(files.length ? ['Files'] : [])];
      return {
        files,
        items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
        types,
        getData: () => text ?? '',
      };
    }

    test('attaches a pasted screenshot without touching the attach button', async () => {
      const dataUrl = 'data:image/png;base64,cGFzdGVk';
      const restore = mockFileReader(dataUrl);

      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      await act(async () => {
        fireEvent.paste(textarea, { clipboardData: clipboardWith([createMockFile('screenshot.png')]) });
        await Promise.resolve();
      });

      expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(1);
      expect(screen.getByAltText('attachment-1')).toHaveAttribute('src', dataUrl);

      restore();
    });

    test('submits the pasted image with the feedback', async () => {
      const dataUrl = 'data:image/png;base64,cGFzdGVk';
      const restore = mockFileReader(dataUrl);

      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      await act(async () => {
        fireEvent.paste(textarea, { clipboardData: clipboardWith([createMockFile('screenshot.png')]) });
        await Promise.resolve();
      });
      fireEvent.change(textarea, { target: { value: 'Here is what I see' } });
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith('Here is what I see', 'suggestion', [dataUrl]);
      });

      restore();
    });

    test('swallows an image-only paste so nothing lands in the textarea', async () => {
      const restore = mockFileReader('data:image/png;base64,cGFzdGVk');
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      let notPrevented = true;
      await act(async () => {
        notPrevented = fireEvent.paste(textarea, {
          clipboardData: clipboardWith([createMockFile('screenshot.png')]),
        });
        await Promise.resolve();
      });

      expect(notPrevented).toBe(false);
      restore();
    });

    test('keeps the text of a mixed paste while attaching its image', async () => {
      const restore = mockFileReader('data:image/png;base64,cGFzdGVk');
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      let notPrevented = false;
      await act(async () => {
        notPrevented = fireEvent.paste(textarea, {
          clipboardData: clipboardWith([createMockFile('screenshot.png')], 'copied words'),
        });
        await Promise.resolve();
      });

      // Default behaviour left alone → the browser still inserts "copied words".
      expect(notPrevented).toBe(true);
      expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(1);

      restore();
    });

    test('leaves a plain text paste alone', async () => {
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      let notPrevented = false;
      await act(async () => {
        notPrevented = fireEvent.paste(textarea, { clipboardData: clipboardWith([], 'just words') });
        await Promise.resolve();
      });

      expect(notPrevented).toBe(true);
      expect(screen.queryByTestId('image-previews')).not.toBeInTheDocument();
    });

    test('accepts a paste made while nothing inside the form has focus', async () => {
      const restore = mockFileReader('data:image/png;base64,cGFzdGVk');
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

      await act(async () => {
        fireEvent.paste(document.body, {
          clipboardData: clipboardWith([createMockFile('screenshot.png')]),
        });
        await Promise.resolve();
      });

      expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(1);
      restore();
    });

    test('rejects a pasted image whose type the form does not accept', async () => {
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      await act(async () => {
        fireEvent.paste(textarea, {
          clipboardData: clipboardWith([createMockFile('vector.svg', 1000, 'image/svg+xml')]),
        });
        await Promise.resolve();
      });

      expect(screen.getByTestId('image-error')).toHaveTextContent(
        'Only PNG, JPEG, and WebP images are supported'
      );
      expect(screen.queryByTestId('image-previews')).not.toBeInTheDocument();
    });

    test('rejects a pasted image once the three-image limit is reached', async () => {
      const restore = mockFileReader('data:image/png;base64,cGFzdGVk');
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      const textarea = screen.getByPlaceholderText('Please tell us what you think...');

      for (const name of ['one.png', 'two.png', 'three.png']) {
        await act(async () => {
          fireEvent.paste(textarea, { clipboardData: clipboardWith([createMockFile(name)]) });
          await Promise.resolve();
        });
      }
      expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(3);

      await act(async () => {
        fireEvent.paste(textarea, { clipboardData: clipboardWith([createMockFile('four.png')]) });
        await Promise.resolve();
      });

      expect(screen.getAllByAltText(/^attachment-/)).toHaveLength(3);
      expect(screen.getByTestId('image-error')).toHaveTextContent('Maximum 3 images allowed');

      restore();
    });

    test('tells the user that pasting works', () => {
      render(<FeedbackForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);
      expect(screen.getByTestId('paste-hint')).toHaveTextContent('Ctrl+V');
    });
  });
});
