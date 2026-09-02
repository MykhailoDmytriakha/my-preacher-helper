import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { splitMarkdownSections } from '@/utils/markdownSections';

import { NoteMobileSheet } from '../NoteMobileSheet';

import type { MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { title?: string }) => {
            if (key === 'textOutline.toggleSection') return `Toggle ${options?.title ?? ''}`;
            const labels: Record<string, string> = {
                'notePanel.outline': 'Outline',
                'notePanel.properties': 'Properties',
                'notePanel.outlineEmpty': 'No headings yet',
                'textOutline.collapseAll': 'Collapse all',
                'textOutline.expandAll': 'Expand all',
                'common.close': 'Close',
            };
            return labels[key] ?? key;
        },
    }),
}));

const NOTE = ['# Outer', 'body', '## Inner', 'more', '# Second', 'tail'].join('\n');

function makeControl(overrides: Partial<MarkdownOutlineControl> = {}): MarkdownOutlineControl {
    return {
        outline: splitMarkdownSections(NOTE),
        sectionIds: ['0', '0.0', '1'],
        hasSections: true,
        everythingCollapsed: false,
        isCollapsed: () => false,
        toggleSection: jest.fn(),
        toggleAll: jest.fn(),
        revealSection: jest.fn(),
        ...overrides,
    };
}

const props = {
    open: true,
    onClose: jest.fn(),
    foldable: true,
    scriptureRefs: <div>refs slot</div>,
    tags: <div>tags slot</div>,
    sermons: <div>sermons slot</div>,
};

describe('NoteMobileSheet', () => {
    beforeEach(() => jest.clearAllMocks());

    it('opens on the outline: the map is what the reader came for', () => {
        render(<NoteMobileSheet {...props} outline={makeControl()} />);

        expect(screen.getByRole('button', { name: 'Outer' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Inner' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument();
    });

    it('jumping to a heading reveals it and closes the sheet — the text is what you wanted to see', () => {
        const revealSection = jest.fn();
        const onClose = jest.fn();
        render(
            <NoteMobileSheet {...props} onClose={onClose} outline={makeControl({ revealSection })} />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Inner' }));

        expect(revealSection).toHaveBeenCalledWith('0.0');
        expect(onClose).toHaveBeenCalled();
    });

    it('the properties tab carries what the side panel carries on a wide screen', () => {
        render(
            <NoteMobileSheet {...props} outline={makeControl()} meta={<span>Created today</span>} />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Properties' }));

        expect(screen.getByText('refs slot')).toBeInTheDocument();
        expect(screen.getByText('tags slot')).toBeInTheDocument();
        expect(screen.getByText('sermons slot')).toBeInTheDocument();
        expect(screen.getByText('Created today')).toBeInTheDocument();
    });

    it('a note with no headings opens on its properties instead of an empty map', () => {
        render(
            <NoteMobileSheet
                {...props}
                outline={makeControl({
                    outline: splitMarkdownSections('just a paragraph'),
                    sectionIds: [],
                    hasSections: false,
                })}
            />
        );

        expect(screen.queryByRole('button', { name: 'Outline' })).not.toBeInTheDocument();
        expect(screen.getByText('refs slot')).toBeInTheDocument();
    });

    it('collapse-all lives with the outline, not floating over the text', () => {
        const toggleAll = jest.fn();
        render(<NoteMobileSheet {...props} outline={makeControl({ toggleAll })} />);

        fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));

        expect(toggleAll).toHaveBeenCalled();
    });

    it('while editing the fold arrows are gone — the editor is not the folding renderer', () => {
        render(<NoteMobileSheet {...props} foldable={false} outline={makeControl()} />);

        expect(screen.queryByRole('button', { name: 'Toggle Outer' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Outer' })).toBeInTheDocument();
    });

    it('Escape closes it: a sheet over the text must not be a trap', () => {
        const onClose = jest.fn();
        render(<NoteMobileSheet {...props} onClose={onClose} outline={makeControl()} />);

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(onClose).toHaveBeenCalled();
    });

    it('a closed sheet is out of the tab order, not merely off-screen', () => {
        const { container } = render(
            <NoteMobileSheet {...props} open={false} outline={makeControl()} />
        );

        // `aria-hidden` alone lies only to screen readers: the outline rows, the tabs and
        // "collapse all" stayed tabbable, and Enter would change fold state invisibly.
        expect(container.firstChild).toHaveAttribute('inert');
    });

    it('an open sheet is reachable again', () => {
        const { container } = render(<NoteMobileSheet {...props} outline={makeControl()} />);

        expect(container.firstChild).not.toHaveAttribute('inert');
    });

    it('opening moves focus into the sheet, so a keyboard user is where the panel is', () => {
        const { container } = render(
            <NoteMobileSheet {...props} open={false} outline={makeControl()} />
        );
        const dialog = container.querySelector('[role="dialog"]') as HTMLElement;

        render(<NoteMobileSheet {...props} open outline={makeControl()} />, {
            container,
        });

        expect(document.activeElement).toBe(dialog);
    });

    it('closing gives focus back to whatever opened it', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        const { container, rerender } = render(
            <NoteMobileSheet {...props} open={false} outline={makeControl()} />
        );
        rerender(<NoteMobileSheet {...props} open outline={makeControl()} />);
        expect(container.querySelector('[role="dialog"]')).toBe(document.activeElement);

        rerender(<NoteMobileSheet {...props} open={false} outline={makeControl()} />);

        expect(document.activeElement).toBe(opener);
        opener.remove();
    });

    it('stays out of the way while closed', () => {
        const onClose = jest.fn();
        const { container } = render(
            <NoteMobileSheet {...props} open={false} onClose={onClose} outline={makeControl()} />
        );

        expect(container.querySelector('[role="dialog"]')).toHaveClass('translate-y-full');
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });
});
