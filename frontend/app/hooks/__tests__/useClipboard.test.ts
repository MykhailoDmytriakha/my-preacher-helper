import { renderHook, act } from '@testing-library/react';
import { useClipboard } from '../useClipboard';

// Mock navigator.clipboard - based on Jest best practices for APIs not in JSDOM
const mockClipboard = {
  writeText: jest.fn().mockResolvedValue(undefined),
};
Object.defineProperty(navigator, 'clipboard', {
  value: mockClipboard,
  writable: true,
});

// Mock document.execCommand for fallback
const mockExecCommand = jest.fn().mockReturnValue(true);
Object.defineProperty(document, 'execCommand', {
  value: mockExecCommand,
  writable: true,
});

// Mock window.isSecureContext for clipboard API availability
Object.defineProperty(window, 'isSecureContext', {
  value: true,
  writable: true,
});

describe('useClipboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns initial state correctly', () => {
    const { result } = renderHook(() => useClipboard());

    expect(result.current.isCopied).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(typeof result.current.copyToClipboard).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('copies text successfully using modern clipboard API', async () => {
    // Mock secure context to ensure modern API is used
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      writable: true,
    });

    const { result } = renderHook(() => useClipboard());

    const testText = 'Test content to copy';

    await act(async () => {
      const success = await result.current.copyToClipboard(testText);
      expect(success).toBe(true);
    });

    expect(mockClipboard.writeText).toHaveBeenCalledWith(testText);
    expect(result.current.isCopied).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('resets copied state after success duration', async () => {
    const { result } = renderHook(() => useClipboard({ successDuration: 100 }));

    await act(async () => {
      await result.current.copyToClipboard('test');
    });

    expect(result.current.isCopied).toBe(true);

    // Wait for reset
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
    });

    expect(result.current.isCopied).toBe(false);
  });

  it('uses fallback copy when clipboard API is not available', async () => {
    // Mock clipboard as unavailable
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });

    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      const success = await result.current.copyToClipboard('test');
      expect(success).toBe(true);
    });

    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('handles clipboard API error and falls back to execCommand', async () => {
    // Mock clipboard API to reject (permission denied)
    mockClipboard.writeText.mockRejectedValueOnce(new Error('Clipboard permission denied'));

    // Mock execCommand to succeed (fallback works)
    mockExecCommand.mockReturnValueOnce(true);

    const onError = jest.fn();
    const { result } = renderHook(() => useClipboard({ onError }));

    await act(async () => {
      const success = await result.current.copyToClipboard('test');
      expect(success).toBe(true); // Should succeed via fallback
    });

    expect(mockExecCommand).toHaveBeenCalledWith('copy');
    expect(onError).not.toHaveBeenCalled(); // No error since fallback worked
  });

  it('handles empty text', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      const success = await result.current.copyToClipboard('');
      expect(success).toBe(false);
    });

    expect(result.current.error).toBe('No text provided');
  });

  it('calls onSuccess callback when copy succeeds', async () => {
    const onSuccess = jest.fn();
    const { result } = renderHook(() => useClipboard({ onSuccess }));

    await act(async () => {
      await result.current.copyToClipboard('test');
    });

    expect(onSuccess).toHaveBeenCalled();
  });

  it('resets state when reset is called', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      await result.current.copyToClipboard('test');
    });

    expect(result.current.isCopied).toBe(true);

    act(() => {
      result.current.reset();
    });

    expect(result.current.isCopied).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('handles fallback copy failure', async () => {
    // Mock clipboard as unavailable and execCommand as failed
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      writable: true,
    });
    mockExecCommand.mockReturnValueOnce(false);

    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      const success = await result.current.copyToClipboard('test');
      expect(success).toBe(false);
    });

    expect(result.current.error).toBe('Fallback copy failed');
  });

  it('handles both modern API and fallback failure', async () => {
    // Mock clipboard API to reject
    mockClipboard.writeText.mockRejectedValueOnce(new Error('Clipboard denied'));

    // Mock fallback to also fail
    mockExecCommand.mockReturnValueOnce(false);

    const onError = jest.fn();
    const { result } = renderHook(() => useClipboard({ onError }));

    await act(async () => {
      const success = await result.current.copyToClipboard('test');
      expect(success).toBe(false);
    });

    expect(result.current.error).toBe('Fallback copy failed');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });
});
