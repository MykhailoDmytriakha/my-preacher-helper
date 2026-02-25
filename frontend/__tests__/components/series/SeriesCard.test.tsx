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

  it('calculates sermon and group count from items if present', () => {
    const seriesWithItems: Series = {
      ...mockSeries,
      items: [
        { id: '1', type: 'sermon', refId: 's1', position: 0 },
        { id: '2', type: 'sermon', refId: 's2', position: 1 },
        { id: '3', type: 'group', refId: 'g1', position: 2 },
      ]
    };
    render(<SeriesCard series={seriesWithItems} />);

    // 2 sermons, 1 group
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders duration correctly when present', () => {
    const seriesWithDuration = { ...mockSeries, duration: 4 };
    render(<SeriesCard series={seriesWithDuration} />);
    expect(screen.getByText('workspaces.series.detail.duration')).toBeInTheDocument();
    expect(screen.getByText('4 weeks')).toBeInTheDocument();
  });

  it('uses default values when optional fields are missing', () => {
    const minSeries: Series = {
      id: 'min1234',
      userId: 'test',
      status: 'draft',
      theme: '',
      bookOrTopic: '',
      sermonIds: [],
      createdAt: '',
      updatedAt: '',
    };
    render(<SeriesCard series={minSeries} />);

    expect(screen.getByText('workspaces.series.description')).toBeInTheDocument();
    expect(screen.getByText('workspaces.series.form.bookOrTopic')).toBeInTheDocument();
    expect(screen.getByText('workspaces.series.form.statuses.draft')).toBeInTheDocument();
  });

  it('renders with a 6-digit hex accent color applying tinted card style', () => {
    const seriesWithHex6: Series = {
      ...mockSeries,
      color: '#ff5733',
    };
    const { container } = render(<SeriesCard series={seriesWithHex6} />);
    // The outer div element should have inline style with rgba background
    const card = container.firstElementChild as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.backgroundColor).toMatch(/rgba\(255,\s*87,\s*51/);
    expect(card.style.borderColor).toMatch(/rgba\(255,\s*87,\s*51/);
  });

  it('renders with a 3-digit shorthand hex accent color', () => {
    const seriesWithHex3: Series = {
      ...mockSeries,
      color: '#f53',
    };
    const { container } = render(<SeriesCard series={seriesWithHex3} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.backgroundColor).toMatch(/rgba\(255,\s*85,\s*51/);
  });

  it('uses default blue tint when color is absent', () => {
    const seriesNoColor: Series = {
      ...mockSeries,
      color: undefined,
    };
    const { container } = render(<SeriesCard series={seriesNoColor} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card).not.toBeNull();
    // Falls back to default #2563EB => rgba(37, 99, 235, ...)
    expect(card.style.backgroundColor).toMatch(/rgba\(37,\s*99,\s*235/);
  });
});
