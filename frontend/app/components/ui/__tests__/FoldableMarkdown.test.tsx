import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { FoldableMarkdown } from '../FoldableMarkdown';

// `react-markdown` is mocked globally (jest.setup.js) and prints markdown verbatim,
// so headings appear here with their hashes. These tests therefore prove the folding
// structure — which text is mounted and which is gone — not the rendered typography.

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { title?: string }) => {
            const labels: Record<string, string> = {
                'textOutline.collapseAll': 'Collapse all',
                'textOutline.expandAll': 'Expand all',
            };
            if (key === 'textOutline.toggleSection') return `Toggle ${options?.title ?? ''}`;
            return labels[key] ?? key;
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
    'Text under the sub heading.',
    '',
    '### Deep heading',
    '',
    'The deepest text.',
].join('\n');

describe('FoldableMarkdown', () => {
    it('renders a note without headings exactly as plain markdown', () => {
        render(<FoldableMarkdown content="Just a paragraph." />);

        expect(screen.getByText('Just a paragraph.')).toBeInTheDocument();
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('shows the text before the first heading and every level below it', () => {
        render(<FoldableMarkdown content={NOTE} />);

        expect(screen.getByText('Opening thought.')).toBeInTheDocument();
        expect(screen.getByText('# Main heading')).toBeInTheDocument();
        expect(screen.getByText('Text under the sub heading.')).toBeInTheDocument();
        expect(screen.getByText('The deepest text.')).toBeInTheDocument();
    });

    it('hides a section body on the first click and brings it back on the second', () => {
        render(<FoldableMarkdown content={NOTE} />);

        const toggle = screen.getByRole('button', { name: 'Toggle Sub heading' });
        expect(toggle).toHaveAttribute('aria-expanded', 'true');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('Text under the sub heading.')).not.toBeInTheDocument();
        expect(screen.queryByText('The deepest text.')).not.toBeInTheDocument();
        // The heading itself stays, otherwise the section could not be reopened.
        expect(screen.getByText('## Sub heading')).toBeInTheDocument();
        // Text outside the folded section is untouched.
        expect(screen.getByText('Text under the main heading.')).toBeInTheDocument();

        fireEvent.click(toggle);
        expect(screen.getByText('Text under the sub heading.')).toBeInTheDocument();
    });

    it('collapses and expands every section from the header control', () => {
        render(<FoldableMarkdown content={NOTE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
        expect(screen.queryByText('Text under the main heading.')).not.toBeInTheDocument();
        expect(screen.getByText('# Main heading')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
        expect(screen.getByText('Text under the main heading.')).toBeInTheDocument();
        expect(screen.getByText('The deepest text.')).toBeInTheDocument();
    });

    it('reveals a collapsed section when the search query matches inside it', () => {
        const { rerender } = render(<FoldableMarkdown content={NOTE} />);

        fireEvent.click(screen.getByRole('button', { name: 'Toggle Sub heading' }));
        expect(screen.queryByText('Text under the sub heading.')).not.toBeInTheDocument();

        rerender(<FoldableMarkdown content={NOTE} searchQuery="deepest" />);
        expect(screen.getByText(/deepest/)).toBeInTheDocument();
    });

    it('offers no collapse-all control for a note with a single heading', () => {
        render(<FoldableMarkdown content={'# Only one\n\nbody'} />);

        expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Toggle Only one' })).toBeInTheDocument();
    });
});
