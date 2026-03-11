import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import {
    clampOutlinePreviewWidth,
    DEFAULT_OUTLINE_PREVIEW_WIDTH,
} from '@/components/ui/richMarkdownStructure';

export function useResizableOutlinePreview() {
    const [previewPanelWidth, setPreviewPanelWidth] = useState(DEFAULT_OUTLINE_PREVIEW_WIDTH);
    const [isPreviewResizing, setIsPreviewResizing] = useState(false);
    const previewResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

    useEffect(() => {
        if (!isPreviewResizing) {
            return;
        }

        const handlePointerMove = (event: PointerEvent) => {
            if (!previewResizeStateRef.current || typeof window === 'undefined') {
                return;
            }

            const { startX, startWidth } = previewResizeStateRef.current;
            const requestedWidth = startWidth + (startX - event.clientX);

            setPreviewPanelWidth(clampOutlinePreviewWidth(requestedWidth, window.innerWidth));
        };

        const handlePointerUp = () => {
            setIsPreviewResizing(false);
            previewResizeStateRef.current = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);

        return () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isPreviewResizing]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleWindowResize = () => {
            setPreviewPanelWidth((currentWidth) => clampOutlinePreviewWidth(currentWidth, window.innerWidth));
        };

        handleWindowResize();
        window.addEventListener('resize', handleWindowResize);

        return () => window.removeEventListener('resize', handleWindowResize);
    }, []);

    const handlePreviewResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (typeof window === 'undefined') {
            return;
        }

        previewResizeStateRef.current = {
            startX: event.clientX,
            startWidth: previewPanelWidth,
        };
        setIsPreviewResizing(true);
        event.preventDefault();
    }, [previewPanelWidth]);

    const handlePreviewResizeReset = useCallback(() => {
        if (typeof window === 'undefined') {
            setPreviewPanelWidth(DEFAULT_OUTLINE_PREVIEW_WIDTH);
            return;
        }

        setPreviewPanelWidth(clampOutlinePreviewWidth(DEFAULT_OUTLINE_PREVIEW_WIDTH, window.innerWidth));
    }, []);

    return {
        previewPanelWidth,
        isPreviewResizing,
        handlePreviewResizeStart,
        handlePreviewResizeReset,
    };
}
