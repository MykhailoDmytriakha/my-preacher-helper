import { useLayoutEffect } from 'react';

/**
 * Hook to lock body scroll when a component is mounted or a condition is met.
 * @param isLocked - Whether the scroll should be locked. Defaults to true.
 */
export const useScrollLock = (isLocked: boolean = true) => {
    useLayoutEffect(() => {
        if (!isLocked) return;

        // Save original overflow style
        const originalStyle = window.getComputedStyle(document.body).overflow;

        // Lock scroll
        document.body.style.overflow = 'hidden';

        return () => {
            // Restore original overflow style
            document.body.style.overflow = originalStyle;
        };
    }, [isLocked]);
};
