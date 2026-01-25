import { buildLocalThoughtId, loadPendingThoughts, savePendingThoughts, LOCAL_THOUGHT_PREFIX } from '@/utils/pendingThoughtsStore';

describe('pendingThoughtsStore', () => {
  it('buildLocalThoughtId uses the local prefix', () => {
    const id = buildLocalThoughtId();
    expect(id.startsWith(LOCAL_THOUGHT_PREFIX)).toBe(true);
  });

  it('saves and loads pending thoughts when IndexedDB is unavailable', async () => {
    const sermonId = 'sermon-123';
    const record = {
      localId: `${LOCAL_THOUGHT_PREFIX}test-1`,
      sermonId,
      sectionId: 'introduction' as const,
      text: 'Pending thought',
      tags: [],
      createdAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      status: 'pending' as const,
    };

    await savePendingThoughts(sermonId, [record]);
    const loaded = await loadPendingThoughts(sermonId);
    expect(loaded).toEqual([record]);

    await savePendingThoughts(sermonId, []);
    const cleared = await loadPendingThoughts(sermonId);
    expect(cleared).toEqual([]);
  });
});
