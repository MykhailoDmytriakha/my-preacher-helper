import { renderHook, act } from '@testing-library/react';

import { useClipboard } from '@/hooks/useClipboard';

describe('useClipboard Hook', () => {
  let mockClipboard: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock clipboard API
    mockClipboard = {
      writeText: jest.fn().mockResolvedValue(undefined),
    };
    Object.assign(navigator, { clipboard: mockClipboard });
    
    // Mock window.isSecureContext
    Object.defineProperty(window, 'isSecureContext', {
      writable: true,
      value: true,
    });
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useClipboard());

    expect(result.current.isCopied).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(typeof result.current.copyToClipboard).toBe('function');
    expect(typeof result.current.reset).toBe('function');
  });

  it('should copy text successfully', async () => {
    const { result } = renderHook(() => useClipboard());
    const testText = 'Test text to copy';

    await act(async () => {
      const success = await result.current.copyToClipboard(testText);
      expect(success).toBe(true);
    });

    expect(mockClipboard.writeText).toHaveBeenCalledWith(testText);
    expect(result.current.isCopied).toBe(true);
    expect(result.current.error).toBe(null);
  });

  it('should handle empty text', async () => {
    const { result } = renderHook(() => useClipboard());

    await act(async () => {
      const success = await result.current.copyToClipboard('');
      expect(success).toBe(false);
    });

    expect(result.current.error).toBe('No text provided');
    expect(mockClipboard.writeText).not.toHaveBeenCalled();
  });
}); 