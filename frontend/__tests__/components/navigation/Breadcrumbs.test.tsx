import { render, screen } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';
import useSermon from '@/hooks/useSermon';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';

// Mock the hooks
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useSearchParams: jest.fn(),
}));

jest.mock('@/hooks/useSermon', () => jest.fn());
jest.mock('@/hooks/useSeriesDetail', () => ({
  useSeriesDetail: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should show Library > Structure for structure page without sermonId', () => {
    mockUsePathname.mockReturnValue('/structure');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Structure')).toBeInTheDocument();
  });

  it('should show Library > Sermon Title > Structure for structure page with sermonId', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id/structure');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
    expect(screen.getByText('Structure')).toBeInTheDocument();
  });

  it('should show Library > Sermon Title for sermons page', () => {
    const mockSermon = { id: 'test-id', title: 'Test Sermon' };
    mockUsePathname.mockReturnValue('/sermons/test-id');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: mockSermon });
    mockUseSeriesDetail.mockReturnValue({ series: null });

    render(<Breadcrumbs />);

    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Test Sermon')).toBeInTheDocument();
  });

  it('should show Library > Series Title for series page', () => {
    const mockSeries = { id: 'test-series-id', title: 'Test Series' };
    mockUsePathname.mockReturnValue('/series/test-series-id');
    mockUseSearchParams.mockReturnValue({
      get: jest.fn().mockReturnValue(null),
    });
    mockUseSermon.mockReturnValue({ sermon: null });
    mockUseSeriesDetail.mockReturnValue({ series: mockSeries });

    render(<Breadcrumbs />);

    expect(screen.getByText('Library')).toBeInTheDocument();
    expect(screen.getByText('Test Series')).toBeInTheDocument();
  });
});
