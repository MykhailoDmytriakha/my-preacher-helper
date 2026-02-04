import { useEffect, useRef, RefObject } from 'react';

interface SwipeOptions {
    onSwipeRight?: () => void;
    onSwipeLeft?: () => void;
    minSwipeDistance?: number;
}

export const useSwipeGesture = (
    elementRef: RefObject<HTMLElement> | null,
    options: SwipeOptions
): void => {
    const {
        onSwipeRight,
        onSwipeLeft,
        minSwipeDistance = 50
    } = options;

    const touchStartX = useRef<number>(0);
    const touchStartY = useRef<number>(0);
    const touchEndX = useRef<number>(0);
    const touchEndY = useRef<number>(0);

    useEffect(() => {
        // If elementRef is provided, use it. Otherwise use window.
        const target = elementRef?.current || window;

        if (!target) return;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX.current = e.changedTouches[0].screenX;
            touchStartY.current = e.changedTouches[0].screenY;
        };

        const handleTouchEnd = (e: TouchEvent) => {
            touchEndX.current = e.changedTouches[0].screenX;
            touchEndY.current = e.changedTouches[0].screenY;
            handleSwipe();
        };

        const handleSwipe = () => {
            const deltaX = touchEndX.current - touchStartX.current;
            const deltaY = touchEndY.current - touchStartY.current;

            if (Math.abs(deltaX) < minSwipeDistance) return;
            if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

            if (deltaX > 0 && onSwipeRight) {
                // Swipe right
                onSwipeRight();
            } else if (deltaX < 0 && onSwipeLeft) {
                // Swipe left
                onSwipeLeft();
            }

            // Reset
            touchStartX.current = 0;
            touchStartY.current = 0;
            touchEndX.current = 0;
            touchEndY.current = 0;
        };

        target.addEventListener('touchstart', handleTouchStart as unknown as EventListener, { passive: true });
        target.addEventListener('touchend', handleTouchEnd as unknown as EventListener, { passive: true });

        return () => {
            target.removeEventListener('touchstart', handleTouchStart as unknown as EventListener);
            target.removeEventListener('touchend', handleTouchEnd as unknown as EventListener);
        };
    }, [elementRef, onSwipeRight, onSwipeLeft, minSwipeDistance]);
};
