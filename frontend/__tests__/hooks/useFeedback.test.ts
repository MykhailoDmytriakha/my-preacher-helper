import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';

import { useFeedback } from '@/hooks/useFeedback';

// Mock feedback service
jest.mock('@services/feedback.service', () => ({
  submitFeedback: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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
    jest.clearAllMocks();
    (submitFeedback as jest.Mock).mockResolvedValue(undefined);
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
      returnValue = await result.current.handleSubmitFeedback(
        'My feedback', 'suggestion', ['data:image/png;base64,abc'], 'user-123'
      );
    });

    expect(submitFeedback).toHaveBeenCalledWith(
      'My feedback', 'suggestion', ['data:image/png;base64,abc'], 'user-123', ''
    );
    expect(result.current.showFeedbackModal).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('feedback.successMessage');
    expect(returnValue).toBe(true);
  });

  test('handleSubmitFeedback uses default images=[] and userId=anonymous when omitted', async () => {
    const { result } = renderHook(() => useFeedback());

    await act(async () => {
      await result.current.handleSubmitFeedback('Minimal', 'bug');
    });

    expect(submitFeedback).toHaveBeenCalledWith('Minimal', 'bug', [], 'anonymous', '');
  });

  test('handleSubmitFeedback shows error toast and returns false on failure', async () => {
    (submitFeedback as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFeedback());

    let returnValue: boolean | void = undefined;
    await act(async () => {
      returnValue = await result.current.handleSubmitFeedback('text', 'type', [], 'user1');
    });

    expect(toast.error).toHaveBeenCalledWith('feedback.errorMessage');
    expect(returnValue).toBe(false);
  });
});
