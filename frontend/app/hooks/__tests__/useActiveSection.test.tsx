import { act, renderHook } from '@testing-library/react';

import { useActiveSection } from '../useActiveSection';

describe('useActiveSection scroll ownership', () => {
    let pane: HTMLDivElement;
    let heading: HTMLDivElement;
    let headingTop: number;

    beforeEach(() => {
        jest.useFakeTimers();
        pane = document.createElement('div');
        heading = document.createElement('div');
        heading.dataset.sectionId = 'inside';
        pane.append(heading);
        document.body.append(pane);
        headingTop = 250;
        pane.getBoundingClientRect = () => ({ top: 200 }) as DOMRect;
        heading.getBoundingClientRect = () => ({ top: headingTop }) as DOMRect;
    });

    afterEach(() => {
        pane.remove();
        jest.useRealTimers();
    });

    function scroll(target: EventTarget) {
        act(() => {
            target.dispatchEvent(new Event('scroll'));
            jest.advanceTimersByTime(20);
        });
    }

    it('tracks native text-pane scrolling using the pane top, not the window', () => {
        const { result } = renderHook(() => useActiveSection(16, true, 'note', pane));
        expect(result.current).toBeNull();
        headingTop = 210;
        scroll(window);
        expect(result.current).toBeNull();
        scroll(pane);
        expect(result.current).toBe('inside');
        headingTop = 230;
        scroll(pane);
        expect(result.current).toBeNull();
    });

    it('retains window scrolling on a phone and switches listeners on resize', () => {
        const { result, rerender } = renderHook(({ root }) => useActiveSection(16, true, 'note', root), {
            initialProps: { root: null as HTMLElement | null },
        });
        headingTop = 10;
        scroll(window);
        expect(result.current).toBe('inside');
        headingTop = 240;
        rerender({ root: pane });
        expect(result.current).toBeNull();
        headingTop = 210;
        scroll(window);
        expect(result.current).toBeNull();
        scroll(pane);
        expect(result.current).toBe('inside');
    });

    it('ignores headings outside the pane and remeasures after viewport changes', () => {
        const outside = document.createElement('div');
        outside.dataset.sectionId = 'outside';
        outside.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
        document.body.append(outside);
        const { result } = renderHook(() => useActiveSection(16, true, 'note', pane));
        expect(result.current).toBeNull();
        headingTop = 210;
        act(() => {
            window.dispatchEvent(new Event('resize'));
            jest.advanceTimersByTime(20);
        });
        expect(result.current).toBe('inside');
        outside.remove();
    });

    it('resets on disable and cancels queued measurements on unmount', () => {
        const { result, rerender, unmount } = renderHook(({ enabled }) => useActiveSection(16, enabled, 'note', pane), {
            initialProps: { enabled: true },
        });
        headingTop = 210;
        scroll(pane);
        expect(result.current).toBe('inside');
        rerender({ enabled: false });
        expect(result.current).toBeNull();
        rerender({ enabled: true });
        act(() => {
            pane.dispatchEvent(new Event('scroll'));
            pane.dispatchEvent(new Event('scroll'));
        });
        unmount();
        expect(jest.getTimerCount()).toBe(0);
    });
});
