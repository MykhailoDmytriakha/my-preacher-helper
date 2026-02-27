import { renderHook, act } from '@testing-library/react';

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

import { submitFeedback } from '@services/feedback.service';

describe('useFeedback', () => {
  let alertSpy: jest.SpyInstance;
  let timeoutSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    // Make setTimeout fire immediately so async tests don't need timer advancement
    timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });
    (submitFeedback as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
    timeoutSpy.mockRestore();
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
      'My feedback', 'suggestion', ['data:image/png;base64,abc'], 'user-123'
    );
    expect(result.current.showFeedbackModal).toBe(false);
    expect(alertSpy).toHaveBeenCalledWith('feedback.successMessage');
    expect(returnValue).toBe(true);
  });

  test('handleSubmitFeedback uses default images=[] and userId=anonymous when omitted', async () => {
    const { result } = renderHook(() => useFeedback());

    await act(async () => {
      await result.current.handleSubmitFeedback('Minimal', 'bug');
    });

    expect(submitFeedback).toHaveBeenCalledWith('Minimal', 'bug', [], 'anonymous');
  });

  test('handleSubmitFeedback shows error alert and returns false on failure', async () => {
    (submitFeedback as jest.Mock).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFeedback());

    let returnValue: boolean | void = undefined;
    await act(async () => {
      returnValue = await result.current.handleSubmitFeedback('text', 'type', [], 'user1');
    });

    expect(alertSpy).toHaveBeenCalledWith('feedback.errorMessage');
    expect(returnValue).toBe(false);
  });
});
