import { renderHook } from '@testing-library/react';

import { useNoteScrollIsolation } from '../useNoteScrollIsolation';

describe('useNoteScrollIsolation', () => {
    let root: HTMLDivElement;
    let panel: HTMLElement;
    let text: HTMLElement;
    let hit: Element;
    let pageScroll: jest.Mock;
    let panelScroll: jest.Mock;

    beforeEach(() => {
        root = document.createElement('div');
        root.innerHTML = '<aside data-note-scroll-region="panel"></aside><article data-note-scroll-region="text"></article>';
        document.body.append(root);
        panel = root.children[0] as HTMLElement;
        text = root.children[1] as HTMLElement;
        hit = panel;
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: jest.fn(() => hit) });
        Object.defineProperty(document, 'scrollingElement', { configurable: true, value: document.documentElement });
        pageScroll = jest.fn();
        panelScroll = jest.fn();
        document.documentElement.scrollBy = pageScroll;
        panel.scrollBy = panelScroll;
    });

    afterEach(() => root.remove());

    function wheel(target: Element, init: WheelEventInit = {}) {
        const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: 100, clientY: 200, deltaY: 80, ...init });
        target.dispatchEvent(event);
        return event;
    }

    it('routes a latched text gesture to the panel under the pointer', () => {
        renderHook(() => useNoteScrollIsolation(root, true));
        expect(wheel(text).defaultPrevented).toBe(true);
        expect(panelScroll).toHaveBeenCalledWith({ top: 80, behavior: 'instant' });
        expect(pageScroll).not.toHaveBeenCalled();
    });

    it('routes the reverse gesture to text without moving the panel', () => {
        renderHook(() => useNoteScrollIsolation(root, true));
        hit = text;
        expect(wheel(panel).defaultPrevented).toBe(true);
        expect(pageScroll).toHaveBeenCalledWith({ top: 80, behavior: 'instant' });
        expect(panelScroll).not.toHaveBeenCalled();
    });

    it('contains input at the panel boundary instead of chaining to the page', () => {
        renderHook(() => useNoteScrollIsolation(root, true));
        expect(wheel(panel, { deltaY: -80 }).defaultPrevented).toBe(true);
        expect(panelScroll).toHaveBeenCalledWith({ top: -80, behavior: 'instant' });
        expect(pageScroll).not.toHaveBeenCalled();
    });

    it('leaves zoom, horizontal gestures, canceled input and overlays alone', () => {
        renderHook(() => useNoteScrollIsolation(root, true));
        expect(wheel(text, { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(wheel(text, { shiftKey: true }).defaultPrevented).toBe(false);
        expect(wheel(text, { deltaX: 100, deltaY: 1 }).defaultPrevented).toBe(false);
        wheel(text, { cancelable: false });
        hit = document.body;
        expect(wheel(text).defaultPrevented).toBe(false);
        expect(panelScroll).not.toHaveBeenCalled();
        expect(pageScroll).not.toHaveBeenCalled();
    });

    it('respects a nested scrolling control and normalizes line and page units', () => {
        const nested = document.createElement('textarea');
        nested.style.overflowY = 'auto';
        nested.style.lineHeight = '24px';
        Object.defineProperty(nested, 'clientHeight', { value: 100 });
        Object.defineProperty(nested, 'scrollHeight', { value: 300 });
        nested.scrollBy = jest.fn();
        panel.append(nested);
        hit = nested;
        renderHook(() => useNoteScrollIsolation(root, true));
        wheel(text, { deltaMode: WheelEvent.DOM_DELTA_LINE, deltaY: 3 });
        expect(nested.scrollBy).toHaveBeenLastCalledWith({ top: 72, behavior: 'instant' });
        wheel(text, { deltaMode: WheelEvent.DOM_DELTA_PAGE, deltaY: 1 });
        expect(nested.scrollBy).toHaveBeenLastCalledWith({ top: 100, behavior: 'instant' });
        expect(panelScroll).not.toHaveBeenCalled();
    });

    it('disables handling on narrow screens and removes listeners on cleanup', () => {
        const { rerender, unmount } = renderHook(({ enabled }) => useNoteScrollIsolation(root, enabled), { initialProps: { enabled: false } });
        expect(wheel(text).defaultPrevented).toBe(false);
        rerender({ enabled: true });
        expect(wheel(text).defaultPrevented).toBe(true);
        unmount();
        expect(wheel(text).defaultPrevented).toBe(false);
    });
});
