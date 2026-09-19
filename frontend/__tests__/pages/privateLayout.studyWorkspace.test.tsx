import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import PrivateLayout from '../../app/(pages)/(private)/layout';

let mockPathname = '/studies/note-1';
let mockSearch = '';
jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
    useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock('@/data-engine/react.client', () => ({
    DataEngineWorkspace: ({ children }: { children: ReactNode }) => <div data-testid="data-engine-workspace">{children}</div>,
}));
jest.mock('@/components/series/SeriesMembershipRecovery', () => ({ SeriesMembershipRecovery: () => <div data-testid="membership-recovery" /> }));
jest.mock('@/components/ProtectedRoute', () => ({ children }: { children: ReactNode }) => children);
jest.mock('@/components/navigation/DashboardNav', () => () => <nav>Navigation</nav>);
jest.mock('@/components/navigation/Breadcrumbs', () => () => <div>Breadcrumbs</div>);
jest.mock('@/components/navigation/DevQuickNav', () => () => null);
jest.mock('@/components/GuestBanner', () => ({ GuestBanner: () => <div>Guest notice</div> }));
jest.mock('@/components/OutboxConflictBanner', () => ({ OutboxConflictBanner: () => <div>Unsent changes</div> }));
jest.mock('@/components/OutboxDrain', () => ({ OutboxDrain: () => <div data-testid="outbox-drain" /> }));

describe('bounded study workspace routing', () => {
    beforeEach(() => { mockSearch = ''; });
    it.each(['/studies/note-1', '/studies/new', '/studies/note-1/'])(
        'includes navigation and notices above the panes at %s', (pathname) => {
            mockPathname = pathname;
            const { container } = render(<PrivateLayout>Note panes</PrivateLayout>);
            const workspace = container.querySelector('[data-study-workspace]');
            expect(workspace).toContainElement(screen.getByRole('navigation'));
            expect(workspace).toContainElement(screen.getByText('Unsent changes'));
            expect(workspace).toContainElement(screen.getByText('Guest notice'));
            expect(workspace).toContainElement(screen.getByRole('main'));
            expect(screen.getByTestId('data-engine-workspace')).toContainElement(screen.getByRole('main'));
        },
    );

    it.each(['/studies', '/studies/share-links', '/sermons/note-1'])(
        'keeps normal document scrolling at %s', (pathname) => {
            mockPathname = pathname;
            const { container } = render(<PrivateLayout>Page content</PrivateLayout>);
            expect(container.querySelector('[data-study-workspace]')).toBeNull();
        },
    );

    it('keeps the workspace and background delivery mounted when preaching hides navigation', () => {
        mockPathname = '/sermons/sermon-1/plan';
        mockSearch = 'planView=preaching';
        render(<PrivateLayout>Preaching content</PrivateLayout>);
        expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
        expect(screen.queryByText('Guest notice')).not.toBeInTheDocument();
        const workspace = screen.getByTestId('data-engine-workspace');
        expect(workspace).toContainElement(screen.getByRole('main'));
        expect(workspace).toContainElement(screen.getByText('Preaching content'));
        expect(workspace).toContainElement(screen.getByTestId('outbox-drain'));
        expect(workspace).toContainElement(screen.getByTestId('membership-recovery'));
    });
});
