import { NextRequest } from 'next/server';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import { POST } from '@/api/feedback/route';
import FeedbackModal from '@/components/navigation/FeedbackModal';
import { useFeedback } from '@/hooks/useFeedback';

// NextResponse.json delegates to the static Web Response.json helper, which
// jsdom does not provide even though the running Next server does.
if (typeof Response.json !== 'function') {
  Response.json = (data: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
}

const mockAdd = jest.fn();

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(() => ({ add: (...args: unknown[]) => mockAdd(...args) })),
  },
}));

jest.mock('@/api/auth/getAuthenticatedIdentity.server', () => ({
  getAuthenticatedIdentity: jest.fn(async () => ({
    uid: 'user-1',
    email: 'user@example.com',
    emailVerified: true,
  })),
}));

jest.mock('@/services/rateLimit.server', () => ({
  consumeSlidingWindowRateLimit: jest.fn(async () => ({ allowed: true, remaining: 19 })),
  FEEDBACK_RATE_LIMIT_MAX_SUBMISSIONS: 20,
  FEEDBACK_RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
}));

jest.mock('@/utils/authenticatedRequest', () => ({
  getAuthenticatedRequestHeaders: jest.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn() },
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'feedback.title': 'Send Feedback',
        'feedback.typeLabel': 'Feedback Type',
        'feedback.typeSuggestion': 'Suggestion',
        'feedback.typeBug': 'Bug Report',
        'feedback.typeQuestion': 'Question',
        'feedback.typeOther': 'Other',
        'feedback.messageLabel': 'Your Feedback',
        'feedback.messagePlaceholder': 'Please tell us what you think...',
        'feedback.imagesLabel': 'Attachments',
        'feedback.attachImages': 'Attach images',
        'feedback.imagesNote': 'Up to 3 images',
        'feedback.pasteHint': 'Paste a screenshot',
        'feedback.attachmentBudgetRemaining': 'Attachment budget remaining',
        'feedback.cancelButton': 'Cancel',
        'feedback.submitButton': 'Submit',
        'feedback.sendingButton': 'Sending...',
        'feedback.successMessage': 'Feedback sent',
        'feedback.errorMessage': 'Feedback failed',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      };
      return translations[key] ?? key;
    },
  }),
}));

function FeedbackHarness() {
  const feedback = useFeedback();
  return (
    <>
      <button type="button" onClick={feedback.handleFeedbackClick}>
        Open feedback
      </button>
      <FeedbackModal
        isOpen={feedback.showFeedbackModal}
        onClose={feedback.closeFeedbackModal}
        onSubmit={(text, type, images) =>
          feedback.handleSubmitFeedback(text, type, images, 'user-1')
        }
      />
    </>
  );
}

describe('feedback refusal from the API boundary through rendered recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdd.mockRejectedValue(
      Object.assign(new Error('Firestore permission denied'), { code: 7 })
    );
    // The route builds a NextRequest, whose init type is stricter than the DOM one about
    // a null `signal`. The cast keeps the test driving the REAL route rather than a stub.
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      POST(new NextRequest('http://localhost/api/feedback', init as ConstructorParameters<typeof NextRequest>[1]))
    ) as jest.Mock;
  });

  it('keeps refused feedback in the open form, says what happened, and shows no success', async () => {
    render(<FeedbackHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Open feedback' }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bug' } });
    fireEvent.change(screen.getByPlaceholderText('Please tell us what you think...'), {
      target: { value: 'Exact refused feedback text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Save refused. Nothing was saved; your text is still here.'
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Please tell us what you think...')).toHaveValue(
      'Exact refused feedback text'
    );
    expect(screen.getByRole('combobox')).toHaveValue('bug');
    expect(toast.success).not.toHaveBeenCalled();
  });
});
