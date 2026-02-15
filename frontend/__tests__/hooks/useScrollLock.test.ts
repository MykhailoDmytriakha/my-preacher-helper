import { renderHook } from '@testing-library/react';
import { useScrollLock } from '@/hooks/useScrollLock';

describe('useScrollLock', () => {
    beforeEach(() => {
        document.body.style.overflow = 'auto';
    });

    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('locks scroll when isLocked is true', () => {
        renderHook(() => useScrollLock(true));
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('does not lock scroll when isLocked is false', () => {
        renderHook(() => useScrollLock(false));
        expect(document.body.style.overflow).toBe('auto');
    });

    it('unlocks scroll on unmount', () => {
        const { unmount } = renderHook(() => useScrollLock(true));
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).toBe('auto');
    });

    it('restores original overflow on unmount', () => {
        document.body.style.overflow = 'scroll';
        const { unmount } = renderHook(() => useScrollLock(true));
        expect(document.body.style.overflow).toBe('hidden');
        unmount();
        expect(document.body.style.overflow).toBe('scroll');
    });
});
