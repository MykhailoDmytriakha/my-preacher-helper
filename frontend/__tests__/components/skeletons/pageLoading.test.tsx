import { render, screen } from '@testing-library/react';

import SermonRouteLoading from '@/(pages)/(private)/sermons/[id]/loading';
import { DashboardStatsSkeleton } from '@/components/skeletons/DashboardStatsSkeleton';
import { SermonCardSkeleton } from '@/components/skeletons/SermonCardSkeleton';
import { SermonDetailSkeleton } from '@/components/skeletons/SermonDetailSkeleton';

// BUG-20261020-offline-sermon-scroll-landing: only a whole-page replacement
// suspends native document anchoring. Geometry is accepted in the real browser.
describe('whole-page loading declaration', () => {
  it.each([
    ['route fallback', SermonRouteLoading],
    ['saved sermon opening', SermonDetailSkeleton],
  ])('declares the %s as a temporary page', (_label, Loading) => {
    render(<main><Loading /></main>);
    expect(screen.getByTestId('sermon-detail-skeleton').closest('[data-page-loading]')).not.toBeNull();
  });

  it('releases the declaration when the readable document replaces it', () => {
    const view = render(<main><SermonDetailSkeleton /></main>);
    expect(view.container.querySelector('[data-page-loading]')).not.toBeNull();
    view.rerender(<main><h1>Saved sermon</h1><p>The preacher can keep reading.</p></main>);
    expect(screen.getByRole('heading', { name: 'Saved sermon' })).toBeVisible();
    expect(view.container.querySelector('[data-page-loading]')).toBeNull();
  });

  it('keeps inline cards and statistics from claiming the whole page', () => {
    const view = render(<main><h1>My sermons</h1><DashboardStatsSkeleton /><SermonCardSkeleton /></main>);
    expect(screen.getByRole('heading', { name: 'My sermons' })).toBeVisible();
    expect(view.container.querySelector('[data-page-loading]')).toBeNull();
  });
});
