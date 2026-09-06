import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import PrivateLayout from '../../app/(pages)/(private)/layout';

let mockPathname = '/studies/note-1';
jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/ProtectedRoute', () => ({ children }: { children: ReactNode }) => children);
jest.mock('@/components/navigation/DashboardNav', () => () => <nav>Navigation</nav>);
jest.mock('@/components/navigation/Breadcrumbs', () => () => <div>Breadcrumbs</div>);
jest.mock('@/components/navigation/DevQuickNav', () => () => null);
jest.mock('@/components/GuestBanner', () => ({ GuestBanner: () => <div>Guest notice</div> }));
jest.mock('@/components/OutboxConflictBanner', () => ({ OutboxConflictBanner: () => <div>Unsent changes</div> }));
jest.mock('@/components/OutboxDrain', () => ({ OutboxDrain: () => null }));

describe('bounded study workspace routing', () => {
    it.each(['/studies/note-1', '/studies/new', '/studies/note-1/'])(
        'includes navigation and notices above the panes at %s', (pathname) => {
            mockPathname = pathname;
            const { container } = render(<PrivateLayout>Note panes</PrivateLayout>);
            const workspace = container.querySelector('[data-study-workspace]');
            expect(workspace).toContainElement(screen.getByRole('navigation'));
            expect(workspace).toContainElement(screen.getByText('Unsent changes'));
            expect(workspace).toContainElement(screen.getByText('Guest notice'));
            expect(workspace).toContainElement(screen.getByRole('main'));
        },
    );

    it.each(['/studies', '/studies/share-links', '/sermons/note-1'])(
        'keeps normal document scrolling at %s', (pathname) => {
            mockPathname = pathname;
            const { container } = render(<PrivateLayout>Page content</PrivateLayout>);
            expect(container.querySelector('[data-study-workspace]')).toBeNull();
        },
    );
});
