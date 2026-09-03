import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { splitMarkdownSections } from '@/utils/markdownSections';

import { NoteSidePanel } from '../NoteSidePanel';

import type { MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { title?: string }) => {
            if (key === 'textOutline.toggleSection') return `Toggle ${options?.title ?? ''}`;
            const labels: Record<string, string> = {
                'notePanel.outline': 'Outline',
                'notePanel.outlineEmpty': 'No headings yet',
                'notePanel.hide': 'Hide panel',
                'notePanel.show': 'Show panel',
                'notePanel.sermons': 'Sermons on this note',
                'studiesWorkspace.scriptureRefs': 'Scripture',
                'studiesWorkspace.tags': 'Tags',
                'textOutline.collapseAll': 'Collapse all',
                'textOutline.expandAll': 'Expand all',
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
    foldable: true,
    stickyTop: 123,
    collapsed: false,
    onToggleCollapsed: jest.fn(),
    scriptureRefs: <div>refs slot</div>,
    tags: <div>tags slot</div>,
};

describe('NoteSidePanel', () => {
    it('lists the note headings as plain text, nested', () => {
        render(<NoteSidePanel {...props} outline={makeControl()} />);

        expect(screen.getByRole('button', { name: 'Outer' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Inner' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Second' })).toBeInTheDocument();
    });

    it('folds through the shared control, not its own state', () => {
        const toggleSection = jest.fn();
        render(<NoteSidePanel {...props} outline={makeControl({ toggleSection })} />);

        // "Outer" is the only row with headings under it, so it is the only one the tree
        // offers an arrow for — see BUG-20260903-fold-arrow-where-nothing-folds.
        fireEvent.click(screen.getByRole('button', { name: 'Toggle Outer' }));
        expect(toggleSection).toHaveBeenCalledWith('0');
    });

    it('opens a section before jumping to it, so the jump never lands in folded text', () => {
        const revealSection = jest.fn();
        const scrollIntoView = jest.fn();
        const target = document.createElement('div');
        target.setAttribute('data-section-id', '0.0');
        target.scrollIntoView = scrollIntoView;
        document.body.appendChild(target);
        jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            (cb as FrameRequestCallback)(0);
            return 0;
        });

        render(<NoteSidePanel {...props} outline={makeControl({ revealSection })} />);
        fireEvent.click(screen.getByRole('button', { name: 'Inner' }));

        expect(revealSection).toHaveBeenCalledWith('0.0');
        expect(scrollIntoView).toHaveBeenCalled();

        target.remove();
        jest.restoreAllMocks();
    });

    it('offers no fold arrows while editing, because there is nothing to fold', () => {
        render(<NoteSidePanel {...props} foldable={false} outline={makeControl()} />);

        expect(screen.queryByRole('button', { name: 'Toggle Outer' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument();
        // The outline still reads as a map of the note.
        expect(screen.getByRole('button', { name: 'Outer' })).toBeInTheDocument();
    });

    it('sticks below the header instead of scrolling away with the text', () => {
        const { container } = render(<NoteSidePanel {...props} outline={makeControl()} />);
        const aside = container.querySelector('aside');

        expect(aside).toHaveClass('sticky');
        expect(aside).toHaveStyle({ top: '123px' });
        // Full height, so the divider does not stop in mid-air.
        expect(aside).toHaveStyle({ height: 'calc(100vh - 123px)' });
    });

    it('marks the section being read, so the map says where you are', () => {
        const { container } = render(
            <NoteSidePanel {...props} outline={makeControl()} activeSectionId="0.0" />
        );

        const highlighted = [...container.querySelectorAll('div')].filter((row) =>
            row.className.includes('bg-emerald-50')
        );
        expect(highlighted).toHaveLength(1);
        expect(highlighted[0]).toHaveTextContent('Inner');
    });

    it('holds the note properties handed to it, exactly once', () => {
        render(<NoteSidePanel {...props} outline={makeControl()} sermons={<div>sermons slot</div>} />);

        expect(screen.getAllByText('refs slot')).toHaveLength(1);
        expect(screen.getAllByText('tags slot')).toHaveLength(1);
        expect(screen.getAllByText('sermons slot')).toHaveLength(1);
    });

    it('collapses to a rail that still says what it holds and leads back in', () => {
        const onToggleCollapsed = jest.fn();
        render(
            <NoteSidePanel
                {...props}
                collapsed
                hasSermons
                onToggleCollapsed={onToggleCollapsed}
                outline={makeControl()}
            />
        );

        // The properties themselves are put away...
        expect(screen.queryByText('refs slot')).not.toBeInTheDocument();
        // ...but every one of them is still named and one click away.
        ['Show panel', 'Outline', 'Scripture', 'Tags', 'Sermons on this note'].forEach((name) => {
            fireEvent.click(screen.getByRole('button', { name }));
        });
        expect(onToggleCollapsed).toHaveBeenCalledTimes(5);
    });

    it('says so when the note has no headings at all', () => {
        const empty = makeControl({
            outline: splitMarkdownSections('just a paragraph'),
            sectionIds: [],
            hasSections: false,
        });
        render(<NoteSidePanel {...props} outline={empty} />);

        expect(screen.getByText('No headings yet')).toBeInTheDocument();
    });
});
