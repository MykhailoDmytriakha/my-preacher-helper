import { renderHook, act } from '@testing-library/react';
import { useFocusMode } from '../useFocusMode';
import { useRouter, usePathname } from 'next/navigation';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock Next.js navigation
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn()
}));

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const buildStructurePath = (sermonId: string = 'sermon-1') => `/sermons/${sermonId}/structure`;
const buildFocusUrl = (section: string, sermonId: string = 'sermon-1') =>
  `${buildStructurePath(sermonId)}?mode=focus&section=${section}`;

describe('useFocusMode', () => {
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn()
  };

  const mockPathname = buildStructurePath();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue(mockRouter);
    mockUsePathname.mockReturnValue(mockPathname);
  });

  describe('initialization', () => {
    it('covers default and URL-driven initialization once', async () => {
      await runScenarios([
        {
          name: 'defaults',
          run: () => {
            const { result } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: 'sermon-1' }));
            expect(result.current.focusedColumn).toBeNull();
            expect(typeof result.current.handleToggleFocusMode).toBe('function');
          },
        },
        {
          name: 'focus params enable focus mode',
          run: () => {
            const { result } = renderHook(() =>
              useFocusMode({ searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'), sermonId: 'sermon-1' }),
            );
            expect(result.current.focusedColumn).toBe('introduction');
          },
        },
        {
          name: 'ignored when mode not focus or invalid section',
          run: () => {
            const { result: normalMode } = renderHook(() =>
              useFocusMode({ searchParams: new URLSearchParams('?mode=normal&section=introduction'), sermonId: 'sermon-1' }),
            );
            expect(normalMode.current.focusedColumn).toBeNull();

            const { result: invalidSection } = renderHook(() =>
              useFocusMode({ searchParams: new URLSearchParams('?mode=focus&section=invalid'), sermonId: 'sermon-1' }),
            );
            expect(invalidSection.current.focusedColumn).toBeNull();
          },
        },
      ]);
    });
  });

  describe('URL parameter handling', () => {
    it('maps section params to focus state in one sweep', async () => {
      await runScenarios([
        {
          name: 'each focusable section',
          run: () => {
            ['introduction', 'main', 'conclusion'].forEach((section) => {
              const { result } = renderHook(() =>
                useFocusMode({ searchParams: new URLSearchParams(`?mode=focus&section=${section}&sermonId=sermon-1`), sermonId: 'sermon-1' }),
              );
              expect(result.current.focusedColumn).toBe(section);
            });
          },
        },
        {
          name: 'missing sermonId and empty params',
          run: () => {
            const { result: missingId } = renderHook(() =>
              useFocusMode({ searchParams: new URLSearchParams('?mode=focus&section=introduction'), sermonId: 'sermon-1' }),
            );
            expect(missingId.current.focusedColumn).toBe('introduction');

            const { result: emptyParams } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: 'sermon-1' }));
            expect(emptyParams.current.focusedColumn).toBeNull();
          },
        },
      ]);
    });
  });

  describe('handleToggleFocusMode', () => {
    it('toggles focus mode on/off across sections inside one test', async () => {
      await runScenarios([
        {
          name: 'enable focus mode for each section',
          run: () => {
            const { result } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: 'sermon-1' }));
            ['introduction', 'main', 'conclusion'].forEach((section) => {
              act(() => result.current.handleToggleFocusMode(section as any));
              expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl(section));
              mockRouter.push.mockClear();
            });
          },
        },
        {
          name: 'toggle off when already focused',
          run: () => {
            const { result } = renderHook(() =>
              useFocusMode({ searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'), sermonId: 'sermon-1' }),
            );
            act(() => result.current.handleToggleFocusMode('introduction'));
            expect(mockRouter.push).toHaveBeenCalledWith(buildStructurePath());
            mockRouter.push.mockClear();
          },
        },
        {
          name: 'switch sections and missing sermonId',
          run: () => {
            const focusedHook = renderHook(() =>
              useFocusMode({ searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'), sermonId: 'sermon-1' }),
            );
            act(() => focusedHook.result.current.handleToggleFocusMode('main'));
            expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl('main'));
            mockRouter.push.mockClear();

            const missingIdHook = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: null as any }));
            act(() => missingIdHook.result.current.handleToggleFocusMode('introduction'));
            expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl('introduction'));
          },
        },
      ]);
    });
  });

  describe('navigateToSection', () => {
    it('navigates to focus URLs for each section in a single test', () => {
      const { result } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: 'sermon-1' }));
      ['introduction', 'main', 'conclusion'].forEach((section) => {
        act(() => result.current.navigateToSection(section as any));
        expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl(section));
        mockRouter.push.mockClear();
      });

      const { result: missingId } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: null as any }));
      act(() => missingId.current.navigateToSection('introduction'));
      expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl('introduction'));
    });
  });

  describe('URL parameter updates', () => {
    it('reacts to search param changes without multiple Jest tests', () => {
      const { result, rerender } = renderHook(
        ({ searchParams, sermonId }) => useFocusMode({ searchParams, sermonId }),
        { initialProps: { searchParams: new URLSearchParams(), sermonId: 'sermon-1' } },
      );
      expect(result.current.focusedColumn).toBeNull();

      rerender({ searchParams: new URLSearchParams('?mode=focus&section=main&sermonId=sermon-1'), sermonId: 'sermon-1' });
      expect(result.current.focusedColumn).toBe('main');

      rerender({ searchParams: new URLSearchParams('?sermonId=sermon-1'), sermonId: 'sermon-1' });
      expect(result.current.focusedColumn).toBeNull();

      rerender({ searchParams: new URLSearchParams('?mode=focus&section=introduction&sermonId=sermon-1'), sermonId: 'sermon-1' });
      expect(result.current.focusedColumn).toBe('introduction');
      rerender({ searchParams: new URLSearchParams('?mode=focus&section=main&sermonId=sermon-1'), sermonId: 'sermon-1' });
      expect(result.current.focusedColumn).toBe('main');
    });
  });

  describe('edge cases and error handling', () => {
    it('guards against invalid params and unusual sermonIds', () => {
      const invalidParams = [
        new URLSearchParams('?mode=focus&section=invalid'),
        new URLSearchParams('?mode=focus&sermonId=sermon-1'),
        new URLSearchParams('?mode=focus&section=&sermonId=sermon-1'),
      ];
      invalidParams.forEach((params) => {
        const { result } = renderHook(() => useFocusMode({ searchParams: params, sermonId: 'sermon-1' }));
        expect(result.current.focusedColumn).toBeNull();
      });

      mockUsePathname.mockReturnValue(buildStructurePath('sermon-123_abc'));
      const { result } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: 'sermon-123_abc' }));
      act(() => result.current.handleToggleFocusMode('introduction'));
      expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl('introduction', 'sermon-123_abc'));
    });
  });

  describe('integration scenarios', () => {
    it('walks through focus workflows and ensures state stability', () => {
      const { result } = renderHook(() => useFocusMode({ searchParams: new URLSearchParams(), sermonId: 'sermon-1' }));
      act(() => result.current.handleToggleFocusMode('introduction'));
      expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl('introduction'));
      mockRouter.push.mockClear();

      act(() => result.current.navigateToSection('main'));
      expect(mockRouter.push).toHaveBeenCalledWith(buildFocusUrl('main'));
      mockRouter.push.mockClear();

      act(() => result.current.handleToggleFocusMode('main'));
      expect(mockRouter.push).toHaveBeenCalledWith(buildStructurePath());

      const { result: rerenderHook, rerender } = renderHook(
        ({ searchParams, sermonId }) => useFocusMode({ searchParams, sermonId }),
        { initialProps: { searchParams: new URLSearchParams('?mode=focus&section=conclusion&sermonId=sermon-1'), sermonId: 'sermon-1' } },
      );
      expect(rerenderHook.current.focusedColumn).toBe('conclusion');
      rerender({ searchParams: new URLSearchParams('?mode=focus&section=conclusion&sermonId=sermon-1'), sermonId: 'sermon-1' });
      expect(rerenderHook.current.focusedColumn).toBe('conclusion');
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
