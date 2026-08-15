import {
  reconcileServerList,
  selectReadableCopy,
} from '@/utils/readFreshness';

const copy = (
  id: string,
  value: string,
  options: { rev?: Record<string, number>; updatedAt?: string } = {}
) => ({ id, value, ...options });

describe('readFreshness', () => {
  it('recognizes a server revision that is ahead without a local aggregate ahead', () => {
    const stored = copy('one', 'stored', { rev: { content: 2, updates: 3 } });
    const server = copy('one', 'server', { rev: { content: 3, updates: 3 } });

    expect(selectReadableCopy(server, stored)).toBe(server);
  });

  it('keeps local work when any local aggregate is ahead', () => {
    const stored = copy('one', 'stored', { rev: { content: 4, updates: 2 } });
    const server = copy('one', 'server', { rev: { content: 3, updates: 5 } });

    expect(selectReadableCopy(server, stored)).toBe(stored);
  });

  /**
   * BUG-20260815-list-copy-hides-scratch, second half.
   *
   * A document created before this rule existed — or by the create route, which
   * stamps neither field — carries NO evidence at all. "Keep the local copy when
   * nothing answers the question" then locks that snapshot in forever: every later
   * server write raises `rev`, the local copy still has none, and the comparison
   * keeps answering "not proven newer".
   *
   * Measured live on a fresh sermon: server `scratch=4, rev={scratch:4}` and a
   * timestamp, local snapshot `scratch=1` with neither field — and the screen kept
   * showing one note over four that were on the server.
   *
   * A copy with no evidence cannot outvote a copy that has some.
   */
  it('accepts the server when the local copy carries no evidence at all', () => {
    const stored = copy('one', 'stored');
    const server = copy('one', 'server', { rev: { scratch: 4 }, updatedAt: '2026-08-15T07:09:32.165Z' });

    expect(selectReadableCopy(server, stored)).toBe(server);
  });

  it('accepts the server on revisions alone when the local copy has nothing', () => {
    const stored = copy('one', 'stored');
    const server = copy('one', 'server', { rev: { scratch: 1 } });

    expect(selectReadableCopy(server, stored)).toBe(server);
  });

  it('still keeps the local copy when NEITHER side can prove anything', () => {
    // Symmetry check: with no evidence anywhere, replacing local work is the one
    // move that can destroy something, so the old answer stands.
    const stored = copy('one', 'stored');
    const server = copy('one', 'server');

    expect(selectReadableCopy(server, stored)).toBe(stored);
  });

  it('falls back to updatedAt when revision counters are absent', () => {
    const stored = copy('one', 'stored', { updatedAt: '2026-08-01T00:00:00.000Z' });
    const server = copy('one', 'server', { updatedAt: '2026-08-05T00:00:00.000Z' });

    expect(selectReadableCopy(server, stored)).toBe(server);
  });

  it('keeps the local copy when neither revisions nor timestamps can answer', () => {
    const stored = copy('one', 'stored');
    const server = copy('one', 'server');

    expect(selectReadableCopy(server, stored)).toBe(stored);
  });

  it('adds server-only documents and retains local-only documents', () => {
    const serverOnly = copy('server-only', 'server', { rev: { content: 1 } });
    const localOnly = copy('local-only', 'local', { rev: { content: 1 } });

    expect(reconcileServerList([serverOnly], [localOnly])).toEqual([serverOnly, localOnly]);
  });
});
