import { render, screen } from '@testing-library/react';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import '@testing-library/jest-dom';

/**
 * "I cannot tell whether this is current" must LOOK different from "this is
 * current". Showing nothing in that state is the quiet lie: the connection drops,
 * the listener goes cache-only, and the person keeps editing what may already be
 * someone else's yesterday — with the screen implying all is well.
 */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => (vars?.entity ? `${key}:${vars.entity}` : key),
  }),
}));

describe('DataFreshnessBanner', () => {
  const noop = () => {};

  it('says the freshness is UNKNOWN rather than implying it is fresh', () => {
    render(<DataFreshnessBanner dirty={false} unknown entityKey="entitySermon" onDismiss={noop} />);

    expect(screen.getByText('freshness.unknownTitle')).toBeInTheDocument();
    expect(
      screen.getByText('freshness.unknownDescription:freshness.entitySermon')
    ).toBeInTheDocument();
  });

  it('offers no "load newer" while unknown — there is nothing known to load', () => {
    render(
      <DataFreshnessBanner dirty={false} unknown entityKey="entitySermon" onRefresh={noop} onDismiss={noop} />
    );

    expect(screen.queryByText('freshness.refreshAction')).not.toBeInTheDocument();
  });

  it('still says CHANGED when the server really holds something newer', () => {
    render(<DataFreshnessBanner dirty={false} entityKey="entityNote" onRefresh={noop} onDismiss={noop} />);

    expect(screen.getByText('freshness.title')).toBeInTheDocument();
    expect(screen.getByText('freshness.refreshAction')).toBeInTheDocument();
  });

  it('a deleted record wins over both', () => {
    render(<DataFreshnessBanner dirty={false} unknown deleted entityKey="entityNote" onDismiss={noop} />);

    expect(screen.getByText('freshness.deletedTitle')).toBeInTheDocument();
  });
});
