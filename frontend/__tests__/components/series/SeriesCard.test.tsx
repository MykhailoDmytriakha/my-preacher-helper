import { render, screen } from '@testing-library/react';
import SeriesCard from '@/components/series/SeriesCard';
import { Series } from '@/models/models';

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));


describe('SeriesCard', () => {
  const mockSeries: Series = {
    id: 'test-series-id',
    userId: 'test-user',
    title: 'Test Series Title',
    theme: 'Test Theme',
    description: 'Test Description',
    bookOrTopic: 'Test Book',
    sermonIds: ['sermon1', 'sermon2'],
    status: 'active',
    color: '#3B82F6',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('renders series title correctly', () => {
    render(<SeriesCard series={mockSeries} />);

    expect(screen.getByText('Test Series Title')).toBeInTheDocument();
  });

  it('renders series theme correctly', () => {
    render(<SeriesCard series={mockSeries} />);

    expect(screen.getByText('Test Theme')).toBeInTheDocument();
  });

  it('renders series description when present', () => {
    render(<SeriesCard series={mockSeries} />);

    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });

  it('renders sermon count correctly', () => {
    render(<SeriesCard series={mockSeries} />);

    expect(screen.getByText('workspaces.series.detail.sermonCount')).toBeInTheDocument();
  });

  it('renders status badge correctly', () => {
    render(<SeriesCard series={mockSeries} />);

    expect(screen.getByText('workspaces.series.form.statuses.active')).toBeInTheDocument();
  });

  it('renders fallback title when title is empty', () => {
    const seriesWithoutTitle = { ...mockSeries, title: '' };

    render(<SeriesCard series={seriesWithoutTitle} />);

    expect(screen.getByText('Series s-id')).toBeInTheDocument(); // id.slice(-4) = 's-id'
  });

  it('renders fallback title when title is undefined', () => {
    const seriesWithoutTitle = { ...mockSeries, title: undefined };

    render(<SeriesCard series={seriesWithoutTitle} />);

    expect(screen.getByText('Series s-id')).toBeInTheDocument(); // id.slice(-4) = 's-id'
  });
});
