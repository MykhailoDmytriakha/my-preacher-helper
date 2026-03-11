import { act, renderHook } from '@testing-library/react';

import {
    clampOutlinePreviewWidth,
    DEFAULT_OUTLINE_PREVIEW_WIDTH,
} from '@/components/ui/richMarkdownStructure';

import { useResizableOutlinePreview } from '../useResizableOutlinePreview';

describe('useResizableOutlinePreview', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 1200,
        });
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });

    it('resizes the preview through pointer drag and cleans up styles on pointer up', () => {
        const { result } = renderHook(() => useResizableOutlinePreview());
        const preventDefault = jest.fn();

        act(() => {
            result.current.handlePreviewResizeStart({
                clientX: 900,
                preventDefault,
            } as never);
        });

        expect(preventDefault).toHaveBeenCalled();
        expect(result.current.isPreviewResizing).toBe(true);
        expect(document.body.style.cursor).toBe('col-resize');

        act(() => {
            window.dispatchEvent(new MouseEvent('pointermove', { clientX: 780 }));
        });

        expect(result.current.previewPanelWidth).toBe(
            clampOutlinePreviewWidth(DEFAULT_OUTLINE_PREVIEW_WIDTH + 120, window.innerWidth)
        );

        act(() => {
            window.dispatchEvent(new Event('pointerup'));
        });

        expect(result.current.isPreviewResizing).toBe(false);
        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
    });

    it('reclamps the width on reset and unmount cleanup', () => {
        const { result, unmount } = renderHook(() => useResizableOutlinePreview());

        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            writable: true,
            value: 700,
        });

        act(() => {
            result.current.handlePreviewResizeReset();
        });

        expect(result.current.previewPanelWidth).toBe(
            clampOutlinePreviewWidth(DEFAULT_OUTLINE_PREVIEW_WIDTH, window.innerWidth)
        );

        act(() => {
            result.current.handlePreviewResizeStart({
                clientX: 900,
                preventDefault: jest.fn(),
            } as never);
        });

        unmount();

        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
    });
});
