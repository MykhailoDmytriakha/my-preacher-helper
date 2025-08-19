import { renderHook, act } from '@testing-library/react';
import { useFocusMode } from '../useFocusMode';
import { useRouter, usePathname } from 'next/navigation';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn()
}));

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe('useFocusMode', () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn()
  };

  const mockPathname = '/structure';

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue(mockRouter);
    mockUsePathname.mockReturnValue(mockPathname);
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
      expect(typeof result.current.handleToggleFocusMode).toBe('function');
      expect(typeof result.current.navigateToSection).toBe('function');
    });

    it('should initialize focus mode from URL parameters', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBe('introduction');
    });

    it('should not initialize focus mode when mode is not focus', () => {
      const searchParams = new URLSearchParams('?mode=normal&section=introduction&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
    });

    it('should not initialize focus mode with invalid section', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=invalid&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
    });
  });

  describe('URL parameter handling', () => {
    it('should handle focus mode with introduction section', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBe('introduction');
    });

    it('should handle focus mode with main section', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=main&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBe('main');
    });

    it('should handle focus mode with conclusion section', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=conclusion&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBe('conclusion');
    });

    it('should handle missing sermonId in URL', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=introduction');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBe('introduction');
    });

    it('should handle empty search params', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
    });
  });

  describe('handleToggleFocusMode', () => {
    it('should toggle focus mode on for introduction section', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.handleToggleFocusMode('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=introduction&sermonId=sermon-1'
      );
    });

    it('should toggle focus mode on for main section', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.handleToggleFocusMode('main');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=main&sermonId=sermon-1'
      );
    });

    it('should toggle focus mode on for conclusion section', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.handleToggleFocusMode('conclusion');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=conclusion&sermonId=sermon-1'
      );
    });

    it('should toggle focus mode off when already focused on same section', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.handleToggleFocusMode('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?sermonId=sermon-1'
      );
    });

    it('should switch focus mode to different section', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.handleToggleFocusMode('main');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=main&sermonId=sermon-1'
      );
    });

    it('should handle missing sermonId gracefully', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: null
      }));

      act(() => {
        result.current.handleToggleFocusMode('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=introduction'
      );
    });
  });

  describe('navigateToSection', () => {
    it('should navigate to introduction section', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.navigateToSection('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=introduction&sermonId=sermon-1'
      );
    });

    it('should navigate to main section', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.navigateToSection('main');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=main&sermonId=sermon-1'
      );
    });

    it('should navigate to conclusion section', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      act(() => {
        result.current.navigateToSection('conclusion');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=conclusion&sermonId=sermon-1'
      );
    });

    it('should handle navigation with missing sermonId', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: null
      }));

      act(() => {
        result.current.navigateToSection('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=introduction'
      );
    });
  });

  describe('URL parameter updates', () => {
    it('should update focusedColumn when searchParams change', () => {
      const { result, rerender } = renderHook(
        ({ searchParams, sermonId }) => useFocusMode({ searchParams, sermonId }),
        {
          initialProps: {
            searchParams: new URLSearchParams(),
            sermonId: 'sermon-1'
          }
        }
      );

      expect(result.current.focusedColumn).toBeNull();

      // Update search params to activate focus mode
      rerender({
        searchParams: new URLSearchParams('?mode=focus&section=main&sermonId=sermon-1'),
        sermonId: 'sermon-1'
      });

      expect(result.current.focusedColumn).toBe('main');
    });

    it('should clear focusedColumn when focus mode is disabled', () => {
      const { result, rerender } = renderHook(
        ({ searchParams, sermonId }) => useFocusMode({ searchParams, sermonId }),
        {
          initialProps: {
            searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'),
            sermonId: 'sermon-1'
          }
        }
      );

      expect(result.current.focusedColumn).toBe('introduction');

      // Disable focus mode
      rerender({
        searchParams: new URLSearchParams('?sermonId=sermon-1'),
        sermonId: 'sermon-1'
      });

      expect(result.current.focusedColumn).toBeNull();
    });

    it('should handle section changes within focus mode', () => {
      const { result, rerender } = renderHook(
        ({ searchParams, sermonId }) => useFocusMode({ searchParams, sermonId }),
        {
          initialProps: {
            searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'),
            sermonId: 'sermon-1'
          }
        }
      );

      expect(result.current.focusedColumn).toBe('introduction');

      // Change section within focus mode
      rerender({
        searchParams: new URLSearchParams('?mode=focus&section=main&sermonId=sermon-1'),
        sermonId: 'sermon-1'
      });

      expect(result.current.focusedColumn).toBe('main');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle invalid section names gracefully', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=invalid&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
    });

    it('should handle missing section parameter', () => {
      const searchParams = new URLSearchParams('?mode=focus&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
    });

    it('should handle empty section parameter', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=&sermonId=sermon-1');
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      expect(result.current.focusedColumn).toBeNull();
    });

    it('should handle special characters in sermonId', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-123_abc'
      }));

      act(() => {
        result.current.handleToggleFocusMode('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=introduction&sermonId=sermon-123_abc'
      );
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete focus mode workflow', () => {
      const searchParams = new URLSearchParams();
      const { result } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      // 1. Enable focus mode for introduction
      act(() => {
        result.current.handleToggleFocusMode('introduction');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=introduction&sermonId=sermon-1'
      );

      // 2. Navigate to main section
      act(() => {
        result.current.navigateToSection('main');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?mode=focus&section=main&sermonId=sermon-1'
      );

      // 3. Disable focus mode
      act(() => {
        result.current.handleToggleFocusMode('main');
      });

      expect(mockRouter.push).toHaveBeenCalledWith(
        '/structure?sermonId=sermon-1'
      );
    });

    it('should maintain focus mode state across re-renders', () => {
      const { result, rerender } = renderHook(
        ({ searchParams, sermonId }) => useFocusMode({ searchParams, sermonId }),
        {
          initialProps: {
            searchParams: new URLSearchParams('?mode=focus&section=conclusion&sermonId=sermon-1'),
            sermonId: 'sermon-1'
          }
        }
      );

      expect(result.current.focusedColumn).toBe('conclusion');

      // Re-render with same props
      rerender({
        searchParams: new URLSearchParams('?mode=focus&section=conclusion&sermonId=sermon-1'),
        sermonId: 'sermon-1'
      });

      expect(result.current.focusedColumn).toBe('conclusion');
    });
  });

  describe('performance considerations', () => {
    it('should not cause unnecessary re-renders', () => {
      const searchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1');
      const { result, rerender } = renderHook(() => useFocusMode({
        searchParams,
        sermonId: 'sermon-1'
      }));

      const initialResult = result.current;

      // Re-render with same props
      rerender({
        searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'),
        sermonId: 'sermon-1'
      });

      // Should maintain same reference for stable values
      expect(result.current.focusedColumn).toBe(initialResult.focusedColumn);
    });
  });
});
