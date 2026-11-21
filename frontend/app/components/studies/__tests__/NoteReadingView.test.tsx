import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

import { splitMarkdownSections } from '@/utils/markdownSections';

import { NoteReadingView } from '@/components/studies/NoteReadingView';

import type { MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { count?: number; current?: number; total?: number }) =>
            options?.count !== undefined ? `${key}:${options.count}`
                : options?.current !== undefined ? `${options.current}/${options.total}` : key,
        language: 'ru',
        i18n: { language: 'ru', resolvedLanguage: 'ru' },
    }),
}));
// The verse texts come from the Bible's book files; here every book is still on its way.
jest.mock('@/components/bible/useBookTexts', () => ({ useBookTexts: () => new Map() }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));
// Markdown is a stub in unit tests (it draws the raw text), so the text is drawn by the app's plain-text linker,
// which finds references the same way (`referencesInText`) and makes each one the same button.
// Each section stands in its own wrapper, as the real renderer draws it (`FoldingPresentation`).
jest.mock('@/components/ui/FoldableMarkdown', () => {
    const { ScriptureText } = jest.requireActual('@/components/bible/ScriptureLinks');
    return {
        FoldableMarkdown: ({ control }: { control: { outline: { sections: Array<{ id: string; headingText: string; body: string }> } } }) => (
            <>{control.outline.sections.map((section) => (
                <section key={section.id} data-section-id={section.id}><h2>{section.headingText}</h2><p><ScriptureText text={section.body} /></p></section>
            ))}</>
        ),
    };
});

const NOTE = ['## Молитва Иависа', 'И воззвал Иавис к Богу (1 Пар 4:10).', '## Рука Господня', 'Рука Господа была с ним (Езд 7:6).'].join('\n');

function makeControl(): MarkdownOutlineControl {
    const outline = splitMarkdownSections(NOTE);
    return {
        outline,
        sectionIds: outline.sections.map((section) => section.id),
        hasSections: true,
        everythingCollapsed: false,
        isCollapsed: () => false,
        toggleSection: jest.fn(),
        toggleAll: jest.fn(),
        revealSection: jest.fn(),
    };
}

function setWide(wide: boolean) {
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: wide && query.includes('1024'), media: query, addEventListener: jest.fn(), removeEventListener: jest.fn(),
        addListener: jest.fn(), removeListener: jest.fn(), onchange: null, dispatchEvent: jest.fn(),
    }));
}

/**
 * Lays the Scripture links of the text at the given distance from the column's top (the column is 800 px tall);
 * everything else spans the column. jsdom lays nothing out by itself.
 */
function placeLinks(tops: Record<string, number>) {
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const top = this.hasAttribute('data-scripture-reference') ? tops[this.textContent ?? ''] : undefined;
        if (top === undefined) return { top: 0, bottom: 800, left: 0, right: 800, width: 800, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
        return { top, bottom: top + 24, left: 0, right: 100, width: 100, height: 24, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
}

function renderView(overrides: Partial<React.ComponentProps<typeof NoteReadingView>> = {}) {
    const props: React.ComponentProps<typeof NoteReadingView> = {
        noteId: 'note-1',
        title: 'Молитва Иависа',
        typeLabel: 'Заметка',
        content: NOTE,
        searchQuery: '',
        outline: makeControl(),
        writtenIn: 'ru',
        startAt: null,
        pager: { index: 1, total: 3, onPrevious: jest.fn(), onNext: jest.fn() },
        onOpenReference: jest.fn(),
        onClose: jest.fn(),
        ...overrides,
    };
    render(<NoteReadingView {...props} />);
    return props;
}

describe('NoteReadingView', () => {
    beforeEach(() => setWide(false));
    afterEach(() => jest.restoreAllMocks());

    it('shows the note alone over the page, with its title, kind, sections and reading time', () => {
        renderView();

        const view = screen.getByTestId('note-reading-view');
        expect(within(view).getByRole('heading', { level: 1, name: 'Молитва Иависа' })).toBeInTheDocument();
        expect(view).toHaveTextContent('Заметка · notePanel.sectionsCount:2 · notePanel.readingMinutes:1');
        // The outline in the margin names every section.
        const outlineNav = within(view).getByRole('navigation', { name: 'notePanel.outline' });
        expect(within(outlineNav).getByRole('button', { name: /Рука Господня/ })).toBeInTheDocument();
    });

    it('closes by the same glasses button and by Escape', () => {
        const props = renderView();

        fireEvent.click(screen.getByRole('button', { name: 'notePanel.exitReadingMode' }));
        expect(props.onClose).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(window, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalledTimes(2);
    });

    it('lists in the margin the Scripture places on screen, not the ones scrolled away', async () => {
        setWide(true);
        placeLinks({ '1 Пар 4:10': 120, 'Езд 7:6': 2400 });
        renderView();

        const margin = screen.getByRole('complementary', { name: 'notePanel.versesOnScreen' });
        const cards = await within(margin).findAllByRole('button');
        expect(cards).toHaveLength(1);
        expect(cards[0].getAttribute('data-verse-key')).toContain('1 Chronicles');
        // The place's words are still on their way: the card says so, the name stands already.
        expect(margin).toHaveTextContent('notePanel.verseLoading');
    });

    it('opens the verse window for a reference pressed in the text on a phone or an iPad', () => {
        const props = renderView();

        fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: /1 Пар 4:10/ }));

        expect(props.onOpenReference).toHaveBeenCalledWith(expect.objectContaining({ book: '1 Chronicles', chapter: 4, fromVerse: 10 }));
    });

    it('lights the verse in the margin instead of covering the text on a computer', async () => {
        setWide(true);
        placeLinks({ '1 Пар 4:10': 120, 'Езд 7:6': 300 });
        const props = renderView();
        const margin = screen.getByRole('complementary', { name: 'notePanel.versesOnScreen' });
        expect(await within(margin).findAllByRole('button')).toHaveLength(2);

        fireEvent.click(within(screen.getByRole('article')).getByRole('button', { name: /1 Пар 4:10/ }));

        expect(props.onOpenReference).not.toHaveBeenCalled();
        const lit = within(margin).getAllByRole('button').filter((card) => card.className.includes('bg-indigo-50'));
        expect(lit).toHaveLength(1);
        expect(lit[0].getAttribute('data-verse-key')).toContain('1 Chronicles');
        // The card itself still opens the full verse window.
        fireEvent.click(lit[0]);
        expect(props.onOpenReference).toHaveBeenCalledTimes(1);
    });

    it('turns to the next note from the end of the text', () => {
        const props = renderView();

        fireEvent.click(screen.getByRole('button', { name: /common\.next/ }));

        expect(props.pager?.onNext).toHaveBeenCalled();
        expect(screen.getByText('2/3')).toBeInTheDocument();
    });

    it('keeps a section jumped to lit through its own scroll, and lets it go when the text scrolls again', () => {
        let now = 1_000_000;
        jest.spyOn(Date, 'now').mockImplementation(() => now);
        renderView();
        const outlineNav = screen.getByRole('navigation', { name: 'notePanel.outline' });
        const first = within(outlineNav).getByRole('button', { name: /Молитва Иависа/ });
        const second = within(outlineNav).getByRole('button', { name: /Рука Господня/ });
        // jsdom gives the column no height: it counts as read to the end, so the last section is the one lit.
        expect(second).toHaveAttribute('aria-current', 'location');

        fireEvent.click(first);
        expect(first).toHaveAttribute('aria-current', 'location');

        // The jump's own scroll, frame after frame: the section stays lit.
        const column = screen.getByRole('article').parentElement!.parentElement!;
        now += 100;
        fireEvent.scroll(column);
        now += 100;
        fireEvent.scroll(column);
        // A key pressed meanwhile does not move the text: still lit.
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(first).toHaveAttribute('aria-current', 'location');

        // Once it settled, the next scroll is the reader's.
        now += 1000;
        fireEvent.scroll(column);
        expect(second).toHaveAttribute('aria-current', 'location');
    });
});
