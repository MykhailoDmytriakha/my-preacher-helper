import { render, screen } from '@testing-library/react';
import React from 'react';

import { splitMarkdownSections } from '@/utils/markdownSections';

import { NoteOutlineTree } from '../NoteOutlineTree';

import type { MarkdownOutlineControl } from '@/hooks/useMarkdownOutline';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { title?: string }) =>
            key === 'textOutline.toggleSection' ? `Toggle ${options?.title ?? ''}` : key,
    }),
}));

// "Outer" owns a nested heading; "Inner" and "Second" carry body text but no headings
// beneath them, so in a tree that draws headings only they are leaves.
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

describe('NoteOutlineTree', () => {
    // BUG-20260903-fold-arrow-where-nothing-folds: every row carried a fold arrow,
    // including rows with no headings under them — clicking those changed nothing in
    // the tree, because a tree of headings has nothing to hide beneath a leaf.
    describe('fold arrow only where the tree has something to fold', () => {
        it('gives a row with nested headings an arrow', () => {
            render(<NoteOutlineTree outline={makeControl()} foldable />);

            expect(screen.getByRole('button', { name: 'Toggle Outer' })).toBeInTheDocument();
        });

        it('marks a row without nested headings as a leaf instead of offering an arrow', () => {
            render(<NoteOutlineTree outline={makeControl()} foldable />);

            expect(screen.queryByRole('button', { name: 'Toggle Inner' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Toggle Second' })).not.toBeInTheDocument();
            // One marker per leaf row, so the list still reads as a list.
            expect(screen.getAllByTestId('outline-leaf-marker')).toHaveLength(2);
        });

        it('drops every arrow while the note is being edited but still marks the leaves', () => {
            render(<NoteOutlineTree outline={makeControl()} foldable={false} />);

            // Nothing folds in the editor, so no row offers an arrow — but a leaf is a
            // leaf whether the note is being read or written, and the bullet says so.
            expect(screen.queryByRole('button', { name: /^Toggle/ })).not.toBeInTheDocument();
            expect(screen.getAllByTestId('outline-leaf-marker')).toHaveLength(2);
        });
    });
});
