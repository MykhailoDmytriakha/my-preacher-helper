// This suite runs against the REAL react-markdown, not the global stub in
// jest.setup.js — that is the whole point of it. `jest.unmock` works here only
// because `next.config.mjs` lists the markdown ESM chain in the test-only
// `transpilePackages`; without that, importing react-markdown throws
// "Unexpected token 'export'".
//
// Keep appearance assertions here and structure assertions in
// `FoldableMarkdown.test.tsx`, which runs fast against the stub.
jest.unmock('react-markdown');
jest.unmock('remark-gfm');
jest.unmock('rehype-raw');
jest.unmock('rehype-sanitize');

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { FoldableMarkdown } from '../FoldableMarkdown';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { title?: string }) => {
            if (key === 'textOutline.toggleSection') return `Toggle ${options?.title ?? ''}`;
            if (key === 'textOutline.collapseAll') return 'Collapse all';
            if (key === 'textOutline.expandAll') return 'Expand all';
            return key;
        },
    }),
}));

const NOTE = [
    'Opening thought.',
    '',
    '# Main heading',
    '',
    'Text under the main heading.',
    '',
    '## Sub heading',
    '',
    'Text with **bold** inside.',
].join('\n');

describe('FoldableMarkdown — rendered output', () => {
    it('renders headings as heading elements, with no hashes left on screen', () => {
        const { container } = render(<FoldableMarkdown content={NOTE} />);

        // MarkdownDisplay downgrades h1 -> <h3> and h2 -> <h4>.
        expect(container.querySelector('h3')).toHaveTextContent('Main heading');
        expect(container.querySelector('h4')).toHaveTextContent('Sub heading');
        expect(container.textContent).not.toContain('#');
    });

    it('renders body markdown as real formatting, not literal characters', () => {
        const { container } = render(<FoldableMarkdown content={NOTE} />);

        expect(container.querySelector('strong')).toHaveTextContent('bold');
        expect(container.textContent).not.toContain('**');
        expect(screen.getByText('Opening thought.').tagName).toBe('P');
    });

    it('puts a section body behind an indent guide, one level per heading depth', () => {
        const { container } = render(<FoldableMarkdown content={NOTE} />);

        const guides = container.querySelectorAll('.border-l');
        // One guide for the h1 section, one for the nested h2 section.
        expect(guides.length).toBe(2);
        // The nested guide lives inside the outer one — that is what "one step
        // further in" means structurally.
        expect(guides[0].contains(guides[1])).toBe(true);
    });

    it('keeps the heading visible and removes its rendered body when folded', () => {
        const { container } = render(<FoldableMarkdown content={NOTE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Toggle Sub heading' }));

        expect(container.querySelector('h4')).toHaveTextContent('Sub heading');
        expect(container.querySelector('strong')).toBeNull();
        expect(container.textContent).not.toContain('Text with');
        // The outer section is untouched by folding an inner one.
        expect(container.querySelector('h3')).toHaveTextContent('Main heading');
        expect(screen.getByText('Text under the main heading.')).toBeInTheDocument();
    });

    it('renders a note without headings as plain prose, with no outline chrome', () => {
        const { container } = render(<FoldableMarkdown content={'Just a **paragraph**.'} />);

        expect(container.querySelector('strong')).toHaveTextContent('paragraph');
        expect(container.querySelector('.border-l')).toBeNull();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
});
