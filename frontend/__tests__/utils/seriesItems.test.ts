import {
  deriveSeriesItemsFromSermonIds,
  deriveSermonIdsFromItems,
  inferSeriesKind,
  normalizeSeriesItems,
  removeSeriesItemByRef,
  reorderSeriesItemsById,
  upsertSeriesItem,
} from '@/utils/seriesItems';

describe('seriesItems utils', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives normalized items from legacy sermon ids', () => {
    const items = deriveSeriesItemsFromSermonIds(['s1', 's2']);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: 'sermon', refId: 's1', position: 1 });
    expect(items[1]).toMatchObject({ type: 'sermon', refId: 's2', position: 2 });
    expect(items[0].id).toContain('sermon-s1-');
  });

  it('normalizes mixed items and repairs invalid fields', () => {
    const items = normalizeSeriesItems([
      { id: '', type: 'unknown' as any, refId: 'x', position: NaN },
      { id: 'ok', type: 'group', refId: 'g1', position: 1 },
      { id: 'drop', type: 'sermon', refId: '', position: 2 },
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'ok', type: 'group', refId: 'g1', position: 1 });
    expect(items[1].type).toBe('sermon');
    expect(items[1].position).toBe(2);
  });

  it('falls back to legacy sermonIds when items are empty', () => {
    const normalized = normalizeSeriesItems([], ['legacy-1', 'legacy-2']);
    expect(normalized.map((item) => item.refId)).toEqual(['legacy-1', 'legacy-2']);
    expect(normalized.map((item) => item.position)).toEqual([1, 2]);
  });

  it('supports upsert, remove and reorder while keeping sequential positions', () => {
    const base = normalizeSeriesItems([
      { id: 's-1', type: 'sermon', refId: 'sermon-1', position: 10 },
      { id: 'g-1', type: 'group', refId: 'group-1', position: 20 },
    ]);

    const upsertedAtStart = upsertSeriesItem(base, { type: 'sermon', refId: 'sermon-2', position: -5 });
    expect(upsertedAtStart[0]).toMatchObject({ type: 'sermon', refId: 'sermon-2', position: 1 });
    expect(upsertedAtStart.map((item) => item.position)).toEqual([1, 2, 3]);

    const deduped = upsertSeriesItem(upsertedAtStart, { type: 'group', refId: 'group-1' });
    expect(deduped.filter((item) => item.type === 'group' && item.refId === 'group-1')).toHaveLength(1);

    const reordered = reorderSeriesItemsById(deduped, [deduped[2].id, deduped[0].id]);
    expect(reordered).toHaveLength(deduped.length);
    expect(reordered.map((item) => item.position)).toEqual([1, 2, 3]);

    const removed = removeSeriesItemByRef(reordered, { type: 'sermon', refId: 'sermon-1' });
    expect(removed.some((item) => item.type === 'sermon' && item.refId === 'sermon-1')).toBe(false);
    expect(removed.map((item) => item.position)).toEqual([1, 2]);
  });

  it('derives sermon ids and infers series kind', () => {
    const mixed = normalizeSeriesItems([
      { id: 's1', type: 'sermon', refId: 'sermon-1', position: 2 },
      { id: 'g1', type: 'group', refId: 'group-1', position: 1 },
    ]);

    expect(deriveSermonIdsFromItems(mixed)).toEqual(['sermon-1']);
    expect(inferSeriesKind(mixed)).toBe('mixed');
    expect(inferSeriesKind(mixed.filter((item) => item.type === 'group'))).toBe('group');
    expect(inferSeriesKind(mixed.filter((item) => item.type === 'sermon'))).toBe('sermon');
  });

  it('uses Date fallback path when Date.now is unavailable', () => {
    const originalNow = Date.now;
    // Trigger getTimeSeed fallback path used by buildItemId
    Object.defineProperty(Date, 'now', { configurable: true, value: undefined });

    const result = deriveSeriesItemsFromSermonIds(['fallback-sermon']);
    expect(result[0].id).toContain('sermon-fallback-sermon-');

    Object.defineProperty(Date, 'now', { configurable: true, value: originalNow });
  });
});
