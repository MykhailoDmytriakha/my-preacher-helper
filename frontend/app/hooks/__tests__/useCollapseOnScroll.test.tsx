import { act, renderHook } from '@testing-library/react';

import { useCollapseOnScroll } from '@/hooks/useCollapseOnScroll';

/** jsdom has no layout, so scrolling is simulated: set the offset, fire the event. */
function scrollTo(y: number) {
    act(() => {
        Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
        window.dispatchEvent(new Event('scroll'));
    });
}

describe('useCollapseOnScroll', () => {
    let frames: Array<() => void>;

    beforeEach(() => {
        frames = [];
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
        // rAF runs the measurement; drive it by hand so each scroll is one settled step.
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            frames.push(() => cb(0));
            return frames.length;
        });
        jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    });

    afterEach(() => jest.restoreAllMocks());

    const settle = () => act(() => { frames.splice(0).forEach((run) => run()); });

    it('keeps the controls while the reader is still at the top', () => {
        const { result } = renderHook(() => useCollapseOnScroll(true));

        scrollTo(40);
        settle();

        expect(result.current).toBe(false);
    });

    it('folds them away once reading has clearly started', () => {
        const { result } = renderHook(() => useCollapseOnScroll(true));

        scrollTo(400);
        settle();

        expect(result.current).toBe(true);
    });

    it('a stray pixel upward does not bring them back — that jitter is worse than the bar', () => {
        const { result } = renderHook(() => useCollapseOnScroll(true));

        scrollTo(400);
        settle();
        scrollTo(395);
        settle();

        expect(result.current).toBe(true);
    });

    it('a deliberate move upward brings them back', () => {
        const { result } = renderHook(() => useCollapseOnScroll(true));

        scrollTo(400);
        settle();
        scrollTo(320);
        settle();

        expect(result.current).toBe(false);
    });

    it('returning to the top brings them back too', () => {
        const { result } = renderHook(() => useCollapseOnScroll(true));

        scrollTo(400);
        settle();
        scrollTo(10);
        settle();

        expect(result.current).toBe(false);
    });

    it('does nothing when disabled — editing needs its controls', () => {
        const { result } = renderHook(() => useCollapseOnScroll(false));

        scrollTo(800);
        settle();

        expect(result.current).toBe(false);
    });
});
