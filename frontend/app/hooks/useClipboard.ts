import { useState, useCallback } from 'react';

interface UseClipboardOptions {
  successDuration?: number;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

interface UseClipboardReturn {
  isCopied: boolean;
  isLoading: boolean;
  error: string | null;
  copyToClipboard: (text: string) => Promise<boolean>;
  reset: () => void;
}

/**
 * Custom hook for clipboard operations with fallback support
 * @param options Configuration options
 * @returns Clipboard state and copy function
 */
export const useClipboard = (options: UseClipboardOptions = {}): UseClipboardReturn => {
  const { 
    successDuration = 1500, 
    onSuccess, 
    onError 
  } = options;

  const [isCopied, setIsCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setIsCopied(false);
    setError(null);
  }, []);

  const fallbackCopy = useCallback((text: string): boolean => {
    try {
      // Create temporary textarea
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      
      document.body.appendChild(textarea);
      textarea.select();
      
      const success = document.execCommand('copy');
      document.body.removeChild(textarea);
      
      return success;
    } catch {
      return false;
    }
  }, []);

  const copyToClipboard = useCallback(async (text: string): Promise<boolean> => {
    if (!text) {
      setError('No text provided');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers or non-secure contexts
        const success = fallbackCopy(text);
        if (!success) {
          throw new Error('Fallback copy failed');
        }
      }

      setIsCopied(true);
      onSuccess?.();

      // Reset copied state after duration
      setTimeout(() => {
        setIsCopied(false);
      }, successDuration);

      return true;
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Copy failed');
      setError(error.message);
      onError?.(error);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [successDuration, onSuccess, onError, fallbackCopy]);

  return {
    isCopied,
    isLoading,
    error,
    copyToClipboard,
    reset
  };
}; 