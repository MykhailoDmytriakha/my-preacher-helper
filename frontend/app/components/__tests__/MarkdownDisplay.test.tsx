import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

jest.mock('react-markdown', () => ({
    __esModule: true,
    default: ({
        children,
        components,
    }: {
        children: string;
        components: Record<string, (...args: any[]) => any>;
    }) => {
        const content = String(children);
        const linkMatch = content.match(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/);

        if (linkMatch) {
            const [, label, href, title] = linkMatch;
            return components.a({
                href,
                title,
                children: label,
            });
        }

        return <div data-testid="markdown">{content}</div>;
    },
}));

const MarkdownDisplay = require('../MarkdownDisplay').default;

describe('MarkdownDisplay', () => {
    it('routes branch hash links through the local branch navigation callback', () => {
        const onBranchLinkClick = jest.fn();

        render(
            <MarkdownDisplay
                content="See [Child Branch](#branch=branch-child)"
                onBranchLinkClick={onBranchLinkClick}
            />
        );

        fireEvent.click(screen.getByRole('link', { name: 'Child Branch' }));

        expect(onBranchLinkClick).toHaveBeenCalledWith('branch-child');
    });

    it('renders relation labels for internal branch links that use markdown titles', () => {
        render(<MarkdownDisplay content='See [Child Branch](#branch=branch-child "supports")' />);

        expect(screen.getByText('studiesWorkspace.outlinePilot.branchRelations.supports')).toBeInTheDocument();
    });

    it('keeps regular links as external links', () => {
        render(<MarkdownDisplay content="Open [Docs](https://example.com/docs)" />);

        expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('target', '_blank');
    });
});
