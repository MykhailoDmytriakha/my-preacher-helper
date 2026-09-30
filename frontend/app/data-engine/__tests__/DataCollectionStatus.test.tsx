import { act, render, screen } from '@testing-library/react';
import { DataCollectionStatus } from '../DataCollectionStatus';
import { STATUS_SETTLE_MS } from '../useLasting';
import type { CollectionState } from '../collections';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const state: CollectionState = { snapshots: [], complete: true, freshness: 'server', checking: false, version: 1, error: null };
it('stays quiet for a confirmed complete list and explains an incomplete cache once it lasts', () => {
  jest.useFakeTimers();
  try {
    const { rerender } = render(<DataCollectionStatus state={state} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<DataCollectionStatus state={{ ...state, complete: false }} />);
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    expect(screen.getByRole('status')).toHaveTextContent('dataSync.collectionIncomplete');
  } finally { jest.useRealTimers(); }
});
it('does not flash "may be incomplete" through a scheduled re-read, which would move the whole list', () => {
  jest.useFakeTimers();
  try {
    const { rerender } = render(<DataCollectionStatus state={state} />);
    rerender(<DataCollectionStatus state={{ ...state, complete: false, checking: true }} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS - 1); });
    rerender(<DataCollectionStatus state={state} />);
    act(() => { jest.advanceTimersByTime(STATUS_SETTLE_MS); });
    expect(screen.queryByRole('status')).toBeNull();
  } finally { jest.useRealTimers(); }
});
it('says nothing about delivery on its way and speaks only for local work needing attention', () => {
  const document = { resource: { collection: 'groups', id: 'g' }, value: {}, pending: true, needsAttention: false, deleting: false };
  const { rerender } = render(<DataCollectionStatus state={{ ...state, documents: [document] }} />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<DataCollectionStatus state={{ ...state, documents: [{ ...document, needsAttention: true }] }} />);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.collectionAttention');
  expect(screen.queryByText('dataSync.phase.queued')).toBeNull();
});
