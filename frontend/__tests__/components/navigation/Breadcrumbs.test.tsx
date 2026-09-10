import { render, screen } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { usePrayerDetail } from '@/hooks/usePrayerDetail';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import useSermon from '@/hooks/useSermon';

// Mock the hooks
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/hooks/useSermon', () => jest.fn());
jest.mock('@/hooks/useSeriesDetail', () => ({
  useSeriesDetail: jest.fn(),
}));
jest.mock('@/hooks/useGroupDetail', () => ({
  useGroupDetail: jest.fn(),
}));
jest.mock('@/hooks/usePrayerDetail', () => ({
  usePrayerDetail: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      if (typeof options === 'object' && options?.defaultValue) {
        return options.defaultValue;
      }
      return key;
    },
  }),
}));

describe('Breadcrumbs', () => {
  const mockUsePathname = usePathname as jest.Mock;
  const mockUseSearchParams = useSearchParams as jest.Mock;
  const mockUseSermon = useSermon as jest.Mock;
  const mockUseSeriesDetail = useSeriesDetail as jest.Mock;
  const mockUseGroupDetail = useGroupDetail as jest.Mock;
  const mockUsePrayerDetail = usePrayerDetail as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should not render for standalone structure page without context', () => {
    mockUsePathname.mockReturnValue('/structure');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    // Single segment pages don't have enough crumbs to render
    // (need root + at least one more segment)
    expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
  });

  it('should show Sermons > Sermon Title > Structure for sermon structure page', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id/structure');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Sermons')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    // The fallback a person sees when i18n has not loaded must be a product word.
    expect(screen.getByText('Structure')).toBeInTheDocument();
  });

  it('should label the hand-written plan segment instead of echoing the route', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id/plan/manual');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Plan')).toBeInTheDocument();
    // Without an entry for it the segment was title-cased straight into the trail.
    expect(screen.getByText('By hand')).toBeInTheDocument();
    expect(screen.queryByText('Manual')).not.toBeInTheDocument();
  });

  /**
   * THE TRAIL NAMES THE MODE ON EVERY PLAN ROUTE.
   *
   * The hand-written editor has a route segment of its own, so its trail read
   * "Plan / By hand". The paired editor lives at `/plan` itself, so the trail stopped at
   * "Plan" and never said which of the three editors was open — the same screen naming its
   * mode on two routes out of three.
   */
  it('names the paired editor in the trail, like the other two modes', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id/plan');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('From thoughts')).toBeInTheDocument();
  });

  it('names the from-a-note editor in the trail with a product word', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id/plan/manual');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockImplementation((key: string) => (key === 'source' ? 'note' : null)),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('From note')).toBeInTheDocument();
    expect(screen.queryByText('plan.fromNote.mode')).not.toBeInTheDocument();
  });

  it('should show Sermons > Sermon Title for sermons detail page', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Sermons')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
  });

  it('should show Series > Series Title for series detail page', () => {
    const mockSeries = { id: 'test-series-id', title: 'Test Series' };
    mockUsePathname.mockReturnValue('/series/test-series-id');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: mockSeries });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Series')).toBeInTheDocument();
    expect(screen.getByText('Test Series')).toBeInTheDocument();
  });

  it('should show Studies as root for studies page', () => {
    mockUsePathname.mockReturnValue('/studies');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    // Single segment pages don't render breadcrumbs (need at least 2 crumbs)
    expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
  });

  /**
   * Studies is the one section where the trail could not name what you opened: every other
   * detail route resolves the real title, this one fell back to the category word ("Study"),
   * so the path read "Studies / Study". And its only link went to a bare `/studies`, while
   * the note page's own back arrow returns to the list WITH the search and filter still
   * applied. A duplicate of a button that does the job better is not navigation, it is
   * 48px of noise above every note.
   */
  it('does not render on a study note — the page carries a better way back', () => {
    mockUsePathname.mockReturnValue('/studies/note-123');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
  });

  it('does not render on the studies share links page either', () => {
    // This one was worse still: with no label configured, the route segment was title-cased
    // into the trail, so a Russian interface read "Изучения / Share Links".
    mockUsePathname.mockReturnValue('/studies/share-links');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
  });

  it('should show Settings as root for settings page', () => {
    mockUsePathname.mockReturnValue('/settings');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    // Single segment pages don't render breadcrumbs
    expect(screen.queryByTestId('breadcrumbs')).not.toBeInTheDocument();
  });

  it('should show Groups > Group Title for group detail page', () => {
    const mockGroup = { id: 'test-group-id', title: 'Family Group #1' };
    mockUsePathname.mockReturnValue('/groups/test-group-id');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: mockGroup });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Family Group #1')).toBeInTheDocument();
  });

  it('should fallback to generic Group label when group data is unavailable', () => {
    mockUsePathname.mockReturnValue('/groups/test-group-id');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Groups')).toBeInTheDocument();
    expect(screen.getByText('Group')).toBeInTheDocument();
  });

  it('should humanize unknown segments into title-cased crumbs', () => {
    mockUsePathname.mockReturnValue('/unknown/foo-bar');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByRole('link', { name: 'Unknown' })).toBeInTheDocument();
    expect(screen.getByText('Foo Bar')).toBeInTheDocument();
  });

  /**
   * The prayer journal became a ROOM inside the pastor's plane, so its trail has to start
   * at the plane. Without the first crumb a person standing on a prayer has no way back to
   * the section they entered from — the heart in the nav is lit, but the trail pretends the
   * plane does not exist.
   */
  it('should open the prayer trail with the pastor plane, then the journal, then the prayer', () => {
    mockUsePathname.mockReturnValue('/prayers/prayer-1');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({
      prayer: { id: 'prayer-1', title: 'Healing Prayer' },
    });

    render(<Breadcrumbs />);

    expect(mockUsePrayerDetail).toHaveBeenCalledWith('prayer-1');

    const plane = screen.getByRole('link', { name: 'Heart matters' });
    expect(plane).toHaveAttribute('href', '/care');
    expect(screen.getByRole('link', { name: 'Prayer Journal' })).toHaveAttribute('href', '/prayers');
    expect(screen.getByText('Healing Prayer')).toBeInTheDocument();
  });

  it('should show the plane above the journal on the prayer list itself', () => {
    mockUsePathname.mockReturnValue('/prayers');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });

    render(<Breadcrumbs />);

    expect(screen.getByRole('link', { name: 'Heart matters' })).toHaveAttribute('href', '/care');
    expect(screen.getByText('Prayer Journal')).toBeInTheDocument();
  });
});
