import { renderHook } from '@testing-library/react';
import { useScrollLock } from '@/hooks/useScrollLock';

describe('useScrollLock', () => {
    beforeEach(() => {
        document.documentElement.style.overflow = 'auto';
    });

    afterEach(() => {
        document.documentElement.style.overflow = '';
    });

    it('locks scroll when isLocked is true', () => {
        renderHook(() => useScrollLock(true));
        expect(document.documentElement.style.overflow).toBe('hidden');
    });

    it('does not lock scroll when isLocked is false', () => {
        renderHook(() => useScrollLock(false));
        expect(document.documentElement.style.overflow).toBe('auto');
    });

    it('unlocks scroll on unmount', () => {
        const { unmount } = renderHook(() => useScrollLock(true));
        expect(document.documentElement.style.overflow).toBe('hidden');
        unmount();
        expect(document.documentElement.style.overflow).toBe('auto');
    });

    it('restores original overflow on unmount', () => {
        document.documentElement.style.overflow = 'scroll';
        const { unmount } = renderHook(() => useScrollLock(true));
        expect(document.documentElement.style.overflow).toBe('hidden');
        unmount();
        expect(document.documentElement.style.overflow).toBe('scroll');
    });
});

/**
 * WHAT A LOCK MUST SURVIVE — the cases the first version did not.
 *
 * One screen can hold two modals at once (a picker opened from inside a form), and the
 * owner's iPad ignores `overflow: hidden` on the body altogether: iOS keeps scrolling the
 * page behind the dialog, which is exactly what was reported.
 */
describe('useScrollLock — more than one lock, and more than one platform', () => {
    beforeEach(() => {
        document.documentElement.style.overflow = 'auto';
        document.body.style.position = '';
        document.body.style.top = '';
    });

    it('keeps the page locked while a second modal is still open', () => {
        const first = renderHook(() => useScrollLock(true));
        const second = renderHook(() => useScrollLock(true));

        first.unmount();

        expect(document.documentElement.style.overflow).toBe('hidden');

        second.unmount();
        expect(document.documentElement.style.overflow).toBe('auto');
    });

    it('holds the page by the root alone, so the body never becomes a scroll box of its own', () => {
        // With `overflow: hidden` on both the root and the body, the body turns into a scroll
        // box: every sticky layer inside it (the app nav, the Bible's book line) drops back to
        // the top of the page, and focus returned to a button in such a layer scrolled the
        // reader to the start of the book (owner, 2026-10-14: 1 Cor 14 → 1 Cor 1).
        document.documentElement.style.overflow = '';
        document.body.style.overflow = 'auto';
        const { unmount } = renderHook(() => useScrollLock(true));
        expect(document.documentElement.style.overflow).toBe('hidden');
        expect(document.body.style.overflow).toBe('auto');
        unmount();
        expect(document.documentElement.style.overflow).toBe('');
        document.body.style.overflow = '';
    });

    it('leaves the page alone when a lock was never armed', () => {
        const { unmount } = renderHook(() => useScrollLock(false));
        unmount();
        expect(document.documentElement.style.overflow).toBe('auto');
    });

    describe('on a device where hidden overflow is not enough', () => {
        const realUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');

        beforeEach(() => {
            Object.defineProperty(navigator, 'userAgent', {
                configurable: true,
                value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.6.1 Safari/605.1.15',
            });
            Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
            window.scrollTo = jest.fn() as unknown as typeof window.scrollTo;
            Object.defineProperty(window, 'scrollY', { configurable: true, value: 240 });
        });

        afterEach(() => {
            if (realUserAgent) Object.defineProperty(navigator, 'userAgent', realUserAgent);
            Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
        });

        it('pins the page in place instead of trusting hidden overflow', () => {
            renderHook(() => useScrollLock(true));

            expect(document.body.style.position).toBe('fixed');
            expect(document.body.style.top).toBe('-240px');
        });

        it('puts the person back where they were reading', () => {
            const { unmount } = renderHook(() => useScrollLock(true));

            unmount();

            expect(document.body.style.position).toBe('');
            expect(window.scrollTo).toHaveBeenCalledWith(0, 240);
        });
    });
});
