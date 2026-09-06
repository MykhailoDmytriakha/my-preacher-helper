import { act, renderHook } from '@testing-library/react';

import { useNoteScrollPosition } from '../useNoteScrollPosition';

describe('note reading position across scroll owners', () => {
    let workspace: HTMLDivElement;
    let pane: HTMLDivElement;
    let heading: HTMLDivElement;
    let paneTop: number;
    let headingTop: number;
    let windowScroll: jest.Mock;
    let paneScroll: jest.Mock;

    beforeEach(() => {
        workspace = document.createElement('div');
        workspace.dataset.noteWorkspace = '';
        const header = document.createElement('header');
        header.getBoundingClientRect = () => ({ bottom: 80 }) as DOMRect;
        pane = document.createElement('div');
        pane.style.overflowY = 'auto';
        heading = document.createElement('div');
        heading.dataset.sectionId = 'section';
        pane.append(heading);
        workspace.append(header, pane);
        document.body.append(workspace);
        paneTop = 100;
        headingTop = 50;
        pane.scrollTop = 500;
        pane.getBoundingClientRect = () => ({ top: paneTop }) as DOMRect;
        heading.getBoundingClientRect = () => ({ top: headingTop }) as DOMRect;
        windowScroll = jest.fn(({ top }: ScrollToOptions) => {
            paneTop -= top!;
            headingTop -= top!;
        });
        paneScroll = jest.fn(({ top }: ScrollToOptions) => {
            pane.scrollTop += top!;
            headingTop -= top!;
        });
        window.scrollBy = windowScroll;
        pane.scrollBy = paneScroll;
        pane.scrollTo = jest.fn();
    });

    afterEach(() => workspace.remove());

    it('preserves the heading offset in both orientation changes', () => {
        const { rerender } = renderHook(({ wide }) => useNoteScrollPosition(pane, wide, 'note'), {
            initialProps: { wide: true },
        });
        expect(paneScroll).not.toHaveBeenCalled();
        pane.style.overflowY = 'visible';
        pane.scrollTop = 0;
        paneTop = -700;
        headingTop = -200;
        rerender({ wide: false });
        expect(windowScroll).toHaveBeenLastCalledWith({ top: -230, behavior: 'instant' });
        expect(headingTop - 80).toBe(-50);

        pane.style.overflowY = 'auto';
        paneTop = 100;
        headingTop = 800;
        rerender({ wide: true });
        expect(paneScroll).toHaveBeenLastCalledWith({ top: 750, behavior: 'instant' });
        expect(headingTop - paneTop).toBe(-50);
    });

    it('ignores the old scroll reset between CSS rotation and React updating', () => {
        const { rerender } = renderHook(({ wide }) => useNoteScrollPosition(pane, wide, 'note'), {
            initialProps: { wide: true },
        });
        headingTop = -400;
        act(() => pane.dispatchEvent(new Event('scroll')));
        pane.style.overflowY = 'visible';
        pane.scrollTop = 0;
        headingTop = 1000;
        act(() => pane.dispatchEvent(new Event('scroll')));
        rerender({ wide: false });
        expect(windowScroll).toHaveBeenLastCalledWith({ top: 1420, behavior: 'instant' });
    });

    it('falls back to the content offset when a folded anchor has disappeared', () => {
        const { rerender } = renderHook(({ wide }) => useNoteScrollPosition(pane, wide, 'note'), {
            initialProps: { wide: true },
        });
        heading.remove();
        pane.style.overflowY = 'visible';
        pane.scrollTop = 0;
        rerender({ wide: false });
        expect(windowScroll).toHaveBeenLastCalledWith({ top: 500, behavior: 'instant' });
    });

    it('supports text without headings and a missing header without inventing an anchor', () => {
        heading.remove();
        workspace.querySelector('header')!.remove();
        const { rerender } = renderHook(({ wide }) => useNoteScrollPosition(pane, wide, 'note'), {
            initialProps: { wide: true },
        });
        pane.style.overflowY = 'visible';
        pane.scrollTop = 0;
        rerender({ wide: false });
        expect(windowScroll).toHaveBeenLastCalledWith({ top: 500, behavior: 'instant' });
    });

    it('starts a different note at the top and detaches on unmount', () => {
        const { rerender, unmount } = renderHook(({ noteId, root }) => useNoteScrollPosition(root, true, noteId), {
            initialProps: { noteId: 'first', root: null as HTMLElement | null },
        });
        rerender({ noteId: 'first', root: pane });
        rerender({ noteId: 'second', root: pane });
        expect(pane.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
        const remove = jest.spyOn(pane, 'removeEventListener');
        unmount();
        expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('keeps a new draft in place on its first autosave, but resets an actual navigation', () => {
        const { rerender } = renderHook(({ noteId, createdId }) => useNoteScrollPosition(pane, true, noteId, createdId), {
            initialProps: { noteId: 'new', createdId: null as string | null },
        });
        rerender({ noteId: 'saved-id', createdId: 'saved-id' });
        expect(pane.scrollTo).not.toHaveBeenCalled();
        expect(pane.scrollTop).toBe(500);
        rerender({ noteId: 'different-note', createdId: 'saved-id' });
        expect(pane.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
    });
});
