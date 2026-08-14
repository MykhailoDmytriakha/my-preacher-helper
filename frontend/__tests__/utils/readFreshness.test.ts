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
