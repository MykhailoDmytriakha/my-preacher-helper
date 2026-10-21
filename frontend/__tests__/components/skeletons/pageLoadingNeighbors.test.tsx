import { render, screen } from '@testing-library/react';

import GroupRouteLoading from '@/(pages)/(private)/groups/[id]/loading';
import PrayerRouteLoading from '@/(pages)/(private)/prayers/[id]/loading';
import SeriesRouteLoading from '@/(pages)/(private)/series/[id]/loading';
import StudyRouteLoading from '@/(pages)/(private)/studies/[id]/loading';
import { RecordUnavailable } from '@/components/RecordUnavailable';

// The actual viewport regression is RED in the installed browser before these declarations.
describe('neighbor whole-page loading boundaries', () => {
  it.each([
    ['series', SeriesRouteLoading],
    ['group', GroupRouteLoading],
    ['prayer', PrayerRouteLoading],
    ['study', StudyRouteLoading],
  ])('declares the unresolved %s route as a temporary page', (_label, Loading) => {
    const view = render(<main><Loading /></main>);
    expect(view.container.querySelector('main > [data-page-loading]')).not.toBeNull();
  });

  it.each([
    { name: 'first unresolved page', checking: true, pageLoading: true, expected: true },
    { name: 'retained words', checking: true, pageLoading: false, expected: false },
    { name: 'completed page', checking: false, pageLoading: true, expected: false },
    { name: 'ordinary status check', checking: true, expected: false },
  ])('keeps the declaration scoped to $name', ({ expected, name, ...props }) => {
    const view = render(<RecordUnavailable {...props} onBack={jest.fn()}>
      {name === 'retained words' && <p>My saved preparation remains readable.</p>}
    </RecordUnavailable>);
    expect(Boolean(view.container.querySelector('[data-page-loading]'))).toBe(expected);
    if (name === 'retained words') expect(screen.getByText('My saved preparation remains readable.')).toBeVisible();
  });
});
