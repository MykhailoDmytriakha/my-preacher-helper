import { renderHook, act } from '@testing-library/react';
import { useRouter, usePathname } from 'next/navigation';

import { useFocusMode } from '../useFocusMode';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  usePathname: jest.fn(),
}));

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

const PATH = '/sermons/sermon-1/structure';
const sp = (q = '') => new URLSearchParams(q);

describe('useFocusMode (section visibility)', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseRouter.mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
    mockUsePathname.mockReturnValue(PATH);
  });

  const setup = (q = '') => renderHook(() => useFocusMode({ searchParams: sp(q), sermonId: 'sermon-1' }));

  describe('initialization', () => {
    it('defaults to all three sections visible (no focus)', () => {
      const { result } = setup();
      expect(result.current.visibleSections).toEqual(['introduction', 'main', 'conclusion']);
      expect(result.current.isFocusMode).toBe(false);
      expect(result.current.focusedColumn).toBeNull();
    });

    it('reads legacy ?mode=focus&section=X as a single visible section (focus)', () => {
      const { result } = setup('?mode=focus&section=introduction');
      expect(result.current.visibleSections).toEqual(['introduction']);
      expect(result.current.isFocusMode).toBe(true);
      expect(result.current.focusedColumn).toBe('introduction');
    });

    it('reads ?sections=a,b as a pair, normalized to canonical order', () => {
      const { result } = setup('?sections=conclusion,introduction');
      expect(result.current.visibleSections).toEqual(['introduction', 'conclusion']);
      expect(result.current.isFocusMode).toBe(false);
      expect(result.current.focusedColumn).toBeNull();
    });

    it('falls back to all three on invalid params', () => {
      expect(setup('?mode=focus&section=invalid').result.current.visibleSections)
        .toEqual(['introduction', 'main', 'conclusion']);
      expect(setup('?sections=bogus').result.current.visibleSections)
        .toEqual(['introduction', 'main', 'conclusion']);
    });
  });

  describe('mutations', () => {
    it('toggleSection hides a section and writes ?sections=', () => {
      const { result } = setup();
      act(() => result.current.toggleSection('main'));
      expect(result.current.visibleSections).toEqual(['introduction', 'conclusion']);
      expect(router.push).toHaveBeenCalledWith(`${PATH}?sections=introduction%2Cconclusion`);
    });

    it('toggleSection keeps at least one section (last toggle is a no-op)', () => {
      const { result } = setup('?sections=introduction');
      act(() => result.current.toggleSection('introduction'));
      expect(result.current.visibleSections).toEqual(['introduction']);
      expect(router.push).not.toHaveBeenCalled();
    });

    it('navigateToSection shows only that section (= focus)', () => {
      const { result } = setup();
      act(() => result.current.navigateToSection('conclusion'));
      expect(result.current.visibleSections).toEqual(['conclusion']);
      expect(router.push).toHaveBeenCalledWith(`${PATH}?sections=conclusion`);
    });

    it('handleToggleFocusMode solos a section, then exits to the whole plan', () => {
      const { result } = setup();
      act(() => result.current.handleToggleFocusMode('main'));
      expect(result.current.visibleSections).toEqual(['main']);
      expect(router.push).toHaveBeenCalledWith(`${PATH}?sections=main`);

      router.push.mockClear();
      act(() => result.current.handleToggleFocusMode('main'));
      expect(result.current.visibleSections).toEqual(['introduction', 'main', 'conclusion']);
      expect(router.push).toHaveBeenCalledWith(PATH);
    });
  });

  describe('URL re-sync', () => {
    it('reacts to external search-param changes', () => {
      const { result, rerender } = renderHook(
        ({ q }) => useFocusMode({ searchParams: sp(q), sermonId: 'sermon-1' }),
        { initialProps: { q: '' } }
      );
      expect(result.current.visibleSections).toEqual(['introduction', 'main', 'conclusion']);
      rerender({ q: '?sections=main,conclusion' });
      expect(result.current.visibleSections).toEqual(['main', 'conclusion']);
      rerender({ q: '?mode=focus&section=introduction' });
      expect(result.current.visibleSections).toEqual(['introduction']);
    });
  });
});
