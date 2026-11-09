import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { PrivateChrome } from '@/components/PrivateWorkspace';

import PrivateLayout from '../../app/(pages)/(private)/layout';

let mockPathname = '/studies/note-1';
let mockSearch = '';
jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
    useSearchParams: () => new URLSearchParams(mockSearch),
}));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
    DataEngineWorkspace: ({ children }: { children: ReactNode }) => <div data-testid="data-engine-workspace">{children}</div>,
}));
jest.mock('@/components/bible/analysis/AnalysisReshapeRecovery', () => ({ AnalysisReshapeRecovery: () => <div data-testid="analysis-recovery" /> }));
jest.mock('@/providers/UserSettingsProvider', () => ({ UserSettingsProvider: ({ children }: { children: ReactNode }) => children, UserSettingsSyncStatus: () => <div data-testid="settings-recovery" /> }));
jest.mock('@/components/series/SeriesMembershipRecovery', () => ({ SeriesMembershipRecovery: () => <div data-testid="membership-recovery" /> }));
jest.mock('@/components/ProtectedRoute', () => ({ children }: { children: ReactNode }) => children);
jest.mock('@/components/navigation/DashboardNav', () => ({ syncNotices }: { syncNotices?: ReactNode }) => <nav>Navigation{syncNotices}</nav>);
jest.mock('@/components/navigation/Breadcrumbs', () => () => <div>Breadcrumbs</div>);
jest.mock('@/components/navigation/DevQuickNav', () => () => null);
jest.mock('@/components/navigation/PageGestures', () => ({ children, enabled: _enabled, ...attributes }: { children: ReactNode; enabled?: boolean }) => <div data-page-gesture="idle" {...attributes}>{children}</div>);
jest.mock('@/components/GuestBanner', () => ({ GuestBanner: () => <div>Guest notice</div> }));
jest.mock('@/components/OutboxConflictBanner', () => ({ OutboxConflictBanner: () => <div>Unsent changes</div> }));
jest.mock('@/components/EngineConflictBanner', () => ({ EngineConflictBanner: () => <div data-testid="engine-conflicts" /> }));
jest.mock('@/components/OutboxDrain', () => ({ OutboxDrain: () => <div data-testid="outbox-drain" /> }));

describe('bounded study workspace routing', () => {
    it('claims the shell and workspace panes only while a study detail is open', () => {
        const { container, rerender } = render(
            <div id="app-shell"><PrivateChrome pathname="/studies/note-1" search="">Note panes</PrivateChrome></div>,
        );
        const shell = container.querySelector('#app-shell');
        const workspace = container.querySelector('[data-page-gesture]');
        expect(shell).toHaveAttribute('data-study-layout');
        expect(workspace).toHaveAttribute('data-study-layout');
        rerender(<div id="app-shell"><PrivateChrome pathname="/studies" search="">Notes list</PrivateChrome></div>);
        expect(shell).not.toHaveAttribute('data-study-layout');
        expect(workspace).not.toHaveAttribute('data-study-layout');
    });

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

describe('Bible sync notice placement', () => {
    it.each(['/bible', '/bible/'])('places current sync recovery in the pinned header at %s', pathname => {
        render(<PrivateChrome pathname={pathname} search="book=john&at=3:16">Bible reader</PrivateChrome>);
        const header = screen.getByRole('navigation');
        expect(header).toContainElement(screen.getByTestId('engine-conflicts'));
        expect(header).toContainElement(screen.getByText('Unsent changes'));
        expect(header).toContainElement(screen.getByTestId('membership-recovery'));
        expect(header).toContainElement(screen.getByTestId('analysis-recovery'));
        expect(header).toContainElement(screen.getByTestId('settings-recovery'));
        expect(header).not.toContainElement(screen.getByText('Bible reader'));
    });

    it('leaves sync recovery in the normal notice area on other pages', () => {
        render(<PrivateChrome pathname="/settings" search="">Settings</PrivateChrome>);
        expect(screen.getByTestId('engine-conflicts')).toBeInTheDocument();
        expect(screen.getByRole('navigation')).not.toContainElement(screen.getByTestId('engine-conflicts'));
    });
});
