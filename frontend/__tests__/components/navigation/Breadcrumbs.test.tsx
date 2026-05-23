import { render, screen } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { usePrayerDetail } from '@/hooks/usePrayerDetail';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useStudyNoteDetail } from '@/hooks/useStudyNoteDetail';
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
jest.mock('@/hooks/useStudyNoteDetail', () => ({
  useStudyNoteDetail: jest.fn(() => ({ note: null, loading: false })),
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
  const mockUseStudyNoteDetail = useStudyNoteDetail as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseStudyNoteDetail.mockReturnValue({ note: null, loading: false });
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

  it('should show Sermons > Sermon Title > ThoughtsBySection for sermon structure page', () => {
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
    expect(screen.getByText('ThoughtsBySection')).toBeInTheDocument();
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

  it('should show Studies > Note Title > Edit for study note edit page', () => {
    mockUsePathname.mockReturnValue('/studies/note-1/edit');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });
    mockUseStudyNoteDetail.mockReturnValue({
      note: { id: 'note-1', title: 'Romans Study' },
      loading: false,
    });

    render(<Breadcrumbs />);

    expect(mockUseStudyNoteDetail).toHaveBeenCalledWith('note-1');
    expect(screen.getByText('Studies')).toBeInTheDocument();
    expect(screen.getByText('Romans Study')).toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('should show Studies > default study label > Edit for unresolved study note edit page', () => {
    mockUsePathname.mockReturnValue('/studies/missing-note/edit');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });
    mockUseStudyNoteDetail.mockReturnValue({ note: null, loading: true });

    render(<Breadcrumbs />);

    expect(mockUseStudyNoteDetail).toHaveBeenCalledWith('missing-note');
    expect(screen.getByText('Studies')).toBeInTheDocument();
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.queryByText('missing-note')).not.toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('should show Studies > default study label > Edit for the new study edit route', () => {
    mockUsePathname.mockReturnValue('/studies/new/edit');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });
    mockUseGroupDetail.mockReturnValue({ group: null });
    mockUsePrayerDetail.mockReturnValue({ prayer: null });
    mockUseStudyNoteDetail.mockReturnValue({ note: null, loading: false });

    render(<Breadcrumbs />);

    expect(mockUseStudyNoteDetail).toHaveBeenCalledWith(null);
    expect(screen.getByText('Studies')).toBeInTheDocument();
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.queryByText('new')).not.toBeInTheDocument();
    expect(screen.getByText('Edit')).toBeInTheDocument();
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

  it('should show Prayers > Prayer Title for prayer detail page', () => {
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
    expect(screen.getByText('Prayer')).toBeInTheDocument();
    expect(screen.getByText('Healing Prayer')).toBeInTheDocument();
  });
});
