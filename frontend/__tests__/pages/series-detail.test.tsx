import { render, screen } from '@testing-library/react';

import SeriesDetailPage from '@/(pages)/(private)/series/[id]/page';
import { useRouteId } from '@/hooks/useRouteId';

// The stub exposes the props the page passes, so the test asserts the arguments and not only the rendering.
jest.mock('@/components/series/EngineSeriesDetail', () => ({
  EngineSeriesDetail: ({ seriesId }: { seriesId: string }) => <div data-testid="engine-series-detail" data-series-id={seriesId} />,
}));

jest.mock('@/hooks/useRouteId', () => ({ useRouteId: jest.fn() }));

const mockUseRouteId = jest.mocked(useRouteId);

describe('SeriesDetailPage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders the engine series detail with the route id', () => {
    mockUseRouteId.mockReturnValue('series-42');

    render(<SeriesDetailPage />);

    expect(screen.getByTestId('engine-series-detail')).toHaveAttribute('data-series-id', 'series-42');
  });

  it('passes an empty series id when the route id is not a string', () => {
    mockUseRouteId.mockReturnValue(undefined as never);

    render(<SeriesDetailPage />);

    expect(screen.getByTestId('engine-series-detail')).toHaveAttribute('data-series-id', '');
  });

  it('remounts the detail when the route id changes', () => {
    mockUseRouteId.mockReturnValue('series-1');
    const { rerender } = render(<SeriesDetailPage />);
    const first = screen.getByTestId('engine-series-detail');

    mockUseRouteId.mockReturnValue('series-2');
    rerender(<SeriesDetailPage />);

    const second = screen.getByTestId('engine-series-detail');
    expect(second).not.toBe(first);
    expect(second).toHaveAttribute('data-series-id', 'series-2');
  });
});
