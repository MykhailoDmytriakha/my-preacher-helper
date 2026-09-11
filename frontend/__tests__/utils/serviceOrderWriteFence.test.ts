import { QueryClient } from '@tanstack/react-query';

import {
  moveWriteFence,
  readOverlappedAWrite,
  readWriteFence,
} from '@/utils/serviceOrderWriteFence';

/**
 * The fence decides whether a read that overlapped a write is allowed to publish. Two properties
 * matter, and they pull in opposite directions: it must be SHARED by every screen holding the
 * list, and it must not OUTLIVE the run that created it.
 */
describe('the orders-of-service write fence', () => {
  it('is shared by everyone using the same query client', () => {
    const client = new QueryClient();

    moveWriteFence(client, 'user-1', 1);

    // A second holder of the hook — the breadcrumb, say — sees the editor's write.
    expect(readWriteFence(client, 'user-1')).toEqual({ epoch: 1, inFlight: 1 });
  });

  /**
   * The reason it is not query data. The app persists successful queries to storage, so a write
   * interrupted by a closed tab would leave `inFlight: 1` behind — and after the reload nothing
   * could ever bring it down. Every later read would see a write under way, keep the cache and
   * ask again, for ever.
   */
  it('leaves nothing in the query cache, which is what gets persisted', () => {
    const client = new QueryClient();

    moveWriteFence(client, 'user-1', 1);

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it('does not let one person\'s writes fence another person\'s reads', () => {
    const client = new QueryClient();

    moveWriteFence(client, 'user-1', 1);

    expect(readWriteFence(client, 'user-2')).toEqual({ epoch: 0, inFlight: 0 });
  });

  it('counts a write down again when it ends', () => {
    const client = new QueryClient();

    moveWriteFence(client, 'user-1', 1);
    moveWriteFence(client, 'user-1', -1);

    // The epoch moves both times: a read that spanned the pair must still know it did.
    expect(readWriteFence(client, 'user-1')).toEqual({ epoch: 2, inFlight: 0 });
  });

  describe('judging a read', () => {
    it('suspects one that began while a write was under way', () => {
      expect(readOverlappedAWrite({ epoch: 4, inFlight: 1 }, { epoch: 4, inFlight: 1 })).toBe(true);
    });

    it('suspects one that a write began and ended around', () => {
      expect(readOverlappedAWrite({ epoch: 4, inFlight: 0 }, { epoch: 6, inFlight: 0 })).toBe(true);
    });

    it('lets a read through when nothing was written during it', () => {
      expect(readOverlappedAWrite({ epoch: 4, inFlight: 0 }, { epoch: 4, inFlight: 0 })).toBe(false);
    });
  });
});
