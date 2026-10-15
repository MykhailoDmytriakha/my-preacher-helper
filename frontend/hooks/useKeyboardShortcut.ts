import { useEffect } from 'react';

import { hasOpenLayer } from '@/hooks/useModalLayer';

interface KeyboardShortcutOptions {
    onEscape?: () => void;
    onBackspace?: () => void;
    enabled?: boolean;
}

export const useKeyboardShortcut = (options: KeyboardShortcutOptions): void => {
    const { onEscape, onBackspace, enabled = true } = options;

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Don't trigger shortcuts if user is typing in an input
            const target = e.target as HTMLElement;
            const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
                target.isContentEditable;

            if (isTyping) return;
            // A window over the page owns the keys: Escape closes it and must not also leave the page
            // under it (a verse opened over the sermon being preached).
            if (hasOpenLayer()) return;

            switch (e.key) {
                case 'Escape':
                    if (onEscape) {
                        e.preventDefault();
                        onEscape();
                    }
                    break;

                case 'Backspace':
                    if (onBackspace) {
                        e.preventDefault();
                        onBackspace();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onEscape, onBackspace, enabled]);
};
