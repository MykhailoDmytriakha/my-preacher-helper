import { Editor } from '@tiptap/core';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';

import { RichMarkdownEditor } from '@/components/ui/RichMarkdownEditor';

// JSDOM supplies no layout. Keep the real editor and native scrolling algorithm,
// supplying only viewport/toolbar/caret geometry; compiled browser tests prove paint.
describe('RichMarkdownEditor caret viewport', () => {
    const originalObserver = global.ResizeObserver;
    const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    let notifyResize: Set<() => void>;

    beforeEach(() => {
        notifyResize = new Set();
        global.ResizeObserver = class {
            private notify: () => void;
            constructor(callback: ResizeObserverCallback) {
                this.notify = () => callback([], this as unknown as ResizeObserver);
                notifyResize.add(this.notify);
            }
            observe() {}
            unobserve() {}
            disconnect() { notifyResize.delete(this.notify); }
        } as unknown as typeof ResizeObserver;
    });

    afterEach(() => {
        jest.restoreAllMocks();
        global.ResizeObserver = originalObserver;
        if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
        else Reflect.deleteProperty(document, 'elementFromPoint');
    });

    async function open(stickyTop?: number) {
        const onChange = jest.fn();
        const view = render(<RichMarkdownEditor value="Authored words" onChange={onChange} stickyToolbarTop={stickyTop} />);
        await waitFor(() => expect(view.container.querySelector('[contenteditable=true]')).not.toBeNull());
        const node = view.container.querySelector<HTMLElement & { editor: Editor }>('[contenteditable=true]')!;
        const editor = node.editor;
        let scroll = 259;
        let toolbarHeight = 45;
        let toolbarTop = stickyTop ?? 0;
        const rect = (top: number, height: number): DOMRect => ({ x: 0, y: top, left: 0, top, right: 800, bottom: top + height, width: 800, height, toJSON: () => ({}) });
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            return this.classList.contains('flex-wrap') && this.querySelector('button[aria-label=Bold]')
                ? rect(toolbarTop, toolbarHeight)
                : rect(-10000, 20000);
        });
        jest.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
            return this === document.documentElement ? 900 : 20000;
        });
        jest.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(800);
        jest.spyOn(window, 'scrollBy').mockImplementation((x: number | ScrollToOptions, y?: number) => {
            scroll += typeof x === 'number' ? y ?? 0 : x?.top ?? 0;
        });
        Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => node.querySelector('p') });
        jest.spyOn(editor.view, 'coordsAtPos').mockImplementation(() => ({ left: 80, right: 80, top: 313 - scroll, bottom: 329 - scroll }));
        const resize = () => act(() => { notifyResize.forEach(notify => notify()); });
        resize();
        return {
            view, editor, onChange,
            caretTop: () => editor.view.coordsAtPos(editor.state.selection.head).top,
            scroll: () => scroll,
            manualScroll: () => { scroll = 259; window.dispatchEvent(new Event('scroll')); },
            changeLayout: (top?: number, height = toolbarHeight) => {
                toolbarTop = top ?? 0; toolbarHeight = height;
                view.rerender(<RichMarkdownEditor value="Authored words" onChange={onChange} stickyToolbarTop={top} />);
                resize();
            },
            type: () => act(() => { editor.view.focus(); editor.chain().insertContent(' more').scrollIntoView().run(); }),
        };
    }

    it('keeps a typed caret below measured sticky controls and follows their resized bounds', async () => {
        const fixture = await open(120);
        try {
            fixture.type();
            expect(fixture.caretTop()).toBeGreaterThanOrEqual(165);
            expect(fixture.editor.getText()).toContain('Authored words');
            expect(fixture.editor.getText()).toContain('more');
            fixture.manualScroll();
            fixture.changeLayout(120);
            expect(fixture.scroll()).toBe(259);
            fixture.changeLayout(200, 90);
            fixture.type();
            expect(fixture.caretTop()).toBeGreaterThanOrEqual(290);
        } finally { fixture.view.unmount(); }
    });

    it('retains native default scrolling without sticky controls, including after opt-out', async () => {
        const fixture = await open();
        try {
            fixture.type();
            expect(fixture.scroll()).toBe(259);
            fixture.changeLayout(120);
            fixture.type();
            expect(fixture.caretTop()).toBeGreaterThanOrEqual(165);
            fixture.changeLayout(undefined);
            fixture.manualScroll();
            fixture.type();
            expect(fixture.scroll()).toBe(259);
        } finally { fixture.view.unmount(); }
    });
});
