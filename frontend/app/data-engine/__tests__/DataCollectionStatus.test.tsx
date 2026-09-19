import { render, screen } from '@testing-library/react';
import { DataCollectionStatus } from '../DataCollectionStatus';
import type { CollectionState } from '../collections';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const state: CollectionState = { snapshots: [], complete: true, freshness: 'server', checking: false, version: 1, error: null };
it('stays quiet for a confirmed complete list and explains an incomplete cache', () => {
  const { rerender } = render(<DataCollectionStatus state={state} />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<DataCollectionStatus state={{ ...state, complete: false }} />);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.collectionIncomplete');
});
it('distinguishes pending delivery from local work needing attention', () => {
  const document = { resource: { collection: 'groups', id: 'g' }, value: {}, pending: true, needsAttention: false, deleting: false };
  const { rerender } = render(<DataCollectionStatus state={{ ...state, documents: [document] }} />);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.phase.queued');
  rerender(<DataCollectionStatus state={{ ...state, documents: [{ ...document, needsAttention: true }] }} />);
  expect(screen.getByRole('status')).toHaveTextContent('dataSync.collectionAttention');
  expect(screen.queryByText('dataSync.phase.queued')).toBeNull();
});
