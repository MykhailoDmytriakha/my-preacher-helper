import { act, renderHook } from '@testing-library/react';

import { useSectionProgress } from '../useSectionProgress';

/**
 * The reading mode's outline fills a bar under each section with how much of it has been read. A column 400 px tall
 * reads at its middle (200 px under its top); three sections start at 0, 300 and 600 px of a 1000 px text.
 */
describe('useSectionProgress', () => {
    let pane: HTMLDivElement;
    let scrollTop: number;
    const starts: Record<string, number> = { a: 0, b: 300, c: 600 };

    beforeEach(() => {
        jest.useFakeTimers();
        scrollTop = 0;
        pane = document.createElement('div');
        const content = document.createElement('div');
        pane.append(content);
        Object.entries(starts).forEach(([id, start]) => {
            const section = document.createElement('section');
            section.dataset.sectionId = id;
            section.getBoundingClientRect = () => ({ top: 100 + start - scrollTop }) as DOMRect;
            content.append(section);
        });
        pane.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
        Object.defineProperty(pane, 'clientHeight', { value: 400 });
        Object.defineProperty(pane, 'scrollHeight', { value: 1000 });
        Object.defineProperty(pane, 'scrollTop', { get: () => scrollTop });
        document.body.append(pane);
    });

    afterEach(() => {
        pane.remove();
        jest.useRealTimers();
    });

    const scrollTo = (top: number) => act(() => {
        scrollTop = top;
        pane.dispatchEvent(new Event('scroll'));
        jest.advanceTimersByTime(20);
    });

    it('counts each section read up to the middle of the column', () => {
        const { result } = renderHook(() => useSectionProgress(pane, ['a', 'b', 'c'], 'note'));

        // The reading line at 200 px of text: two thirds of the first section, nothing of the others.
        expect(result.current.bySection.a).toBeCloseTo(200 / 300);
        expect(result.current.bySection.b).toBe(0);
        expect(result.current.overall).toBe(0);

        scrollTo(250);
        // The line at 450 px: the first read through, half of the second.
        expect(result.current.bySection.a).toBe(1);
        expect(result.current.bySection.b).toBeCloseTo(0.5);
        expect(result.current.bySection.c).toBe(0);
        expect(result.current.overall).toBeCloseTo(250 / 600);
    });

    it('marks everything read at the bottom, a last section too short to reach the line included', () => {
        const { result } = renderHook(() => useSectionProgress(pane, ['a', 'b', 'c'], 'note'));

        scrollTo(600);

        expect(result.current.bySection).toEqual({ a: 1, b: 1, c: 1 });
        expect(result.current.overall).toBe(1);
    });

    it('looks for sections only inside its own column', () => {
        // The reading mode draws the note over its page: the same ids stand outside the column too.
        const outside = document.createElement('section');
        outside.dataset.sectionId = 'b';
        outside.getBoundingClientRect = () => ({ top: -5000 }) as DOMRect;
        document.body.prepend(outside);

        const { result } = renderHook(() => useSectionProgress(pane, ['a', 'b', 'c'], 'note'));

        expect(result.current.bySection.b).toBe(0);
        outside.remove();
    });

    it('stays empty without a column', () => {
        const { result } = renderHook(() => useSectionProgress(null, ['a'], 'note'));

        expect(result.current).toEqual({ bySection: {}, overall: 0 });
    });
});
