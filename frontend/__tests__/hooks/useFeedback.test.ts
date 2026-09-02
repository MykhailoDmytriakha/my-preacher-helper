import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';

import { useFeedback } from '@/hooks/useFeedback';

// Mock feedback service
jest.mock('@services/feedback.service', () => ({
  submitFeedback: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key === 'writeRecovery.refused'
      ? 'Save refused. Nothing was saved; your text is still here.'
      : key,
  }),
}));

// Mock sonner toast
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

import { submitFeedback } from '@services/feedback.service';

describe('useFeedback', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (submitFeedback as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('initial state: modal is closed', () => {
    const { result } = renderHook(() => useFeedback());
    expect(result.current.showFeedbackModal).toBe(false);
  });

  test('handleFeedbackClick opens the modal', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.handleFeedbackClick();
    });

    expect(result.current.showFeedbackModal).toBe(true);
  });

  test('closeFeedbackModal closes the modal', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => { result.current.handleFeedbackClick(); });
    expect(result.current.showFeedbackModal).toBe(true);

    act(() => { result.current.closeFeedbackModal(); });
    expect(result.current.showFeedbackModal).toBe(false);
  });

  test('handleSubmitFeedback calls submitFeedback with images and closes modal on success', async () => {
    const { result } = renderHook(() => useFeedback());

    act(() => { result.current.handleFeedbackClick(); });
    expect(result.current.showFeedbackModal).toBe(true);

    let returnValue: boolean | void = undefined;
    await act(async () => {
      const submission = result.current.handleSubmitFeedback(
        'My feedback', 'suggestion', ['data:image/png;base64,abc'], 'user-123'
      );
      await jest.runAllTimersAsync();
      returnValue = await submission;
    });

    expect(submitFeedback).toHaveBeenCalledWith(
      'My feedback', 'suggestion', ['data:image/png;base64,abc'], 'user-123'
    );
    expect(result.current.showFeedbackModal).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('feedback.successMessage');
    expect(returnValue).toBe(true);
  });

  test('handleSubmitFeedback uses default images=[] and userId=anonymous when omitted', async () => {
    const { result } = renderHook(() => useFeedback());

    await act(async () => {
      const submission = result.current.handleSubmitFeedback('Minimal', 'bug');
      await jest.runAllTimersAsync();
      await submission;
    });

    expect(submitFeedback).toHaveBeenCalledWith('Minimal', 'bug', [], 'anonymous');
  });

  test('handleSubmitFeedback shows error toast and returns false on failure', async () => {
    (submitFeedback as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFeedback());
    act(() => result.current.handleFeedbackClick());

    let returnValue: boolean | void = undefined;
    await act(async () => {
      const submission = result.current.handleSubmitFeedback('text', 'type', [], 'user1');
      await jest.runAllTimersAsync();
      returnValue = await submission;
    });

    expect(toast.error).toHaveBeenCalledWith('feedback.errorMessage');
    expect(returnValue).toBe(false);
    expect(result.current.showFeedbackModal).toBe(true);
  });

  test('preserves a rules refusal for the form and keeps the modal open', async () => {
    (submitFeedback as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Forbidden'), { code: 'permission-denied' })
    );
    const { result } = renderHook(() => useFeedback());
    act(() => result.current.handleFeedbackClick());

    let refusal: unknown;
    await act(async () => {
      const submission = result.current
        .handleSubmitFeedback('Exact refused feedback', 'bug')
        .catch((error) => {
          refusal = error;
        });
      await jest.runAllTimersAsync();
      await submission;
    });

    expect(refusal).toMatchObject({ code: 'permission-denied' });
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.showFeedbackModal).toBe(true);
  });

  test('keeps a paused offline submission silent while no terminal answer exists', async () => {
    let resolveSubmission!: () => void;
    (submitFeedback as jest.Mock).mockReturnValue(new Promise<void>((resolve) => {
      resolveSubmission = resolve;
    }));
    const { result } = renderHook(() => useFeedback());
    act(() => result.current.handleFeedbackClick());

    let submission!: Promise<boolean>;
    act(() => {
      submission = result.current.handleSubmitFeedback('Queued feedback', 'suggestion');
    });

    await act(async () => Promise.resolve());
    expect(result.current.showFeedbackModal).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();

    await act(async () => {
      resolveSubmission();
      await jest.runAllTimersAsync();
      await submission;
    });
  });
});
