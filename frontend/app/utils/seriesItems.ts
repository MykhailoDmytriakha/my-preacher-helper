import { SeriesItem, SeriesItemType, SeriesKind } from '@/models/models';

const KNOWN_ITEM_TYPES: SeriesItemType[] = ['sermon', 'group'];

const isKnownItemType = (value: string): value is SeriesItemType =>
  KNOWN_ITEM_TYPES.includes(value as SeriesItemType);


const buildItemId = (type: SeriesItemType, refId: string) => {
  return `${type}-${refId}`;
};

const withSequentialPositions = (items: SeriesItem[]) =>
  items.map((item, index) => ({ ...item, position: index + 1 }));

export const deriveSeriesItemsFromSermonIds = (sermonIds: string[] = []): SeriesItem[] =>
  sermonIds.map((sermonId, index) => ({
    id: buildItemId('sermon', sermonId),
    type: 'sermon',
    refId: sermonId,
    position: index + 1,
  }));

export const normalizeSeriesItems = (
  items: SeriesItem[] | undefined,
  legacySermonIds: string[] = []
): SeriesItem[] => {
  const source = items && items.length > 0 ? items : deriveSeriesItemsFromSermonIds(legacySermonIds);

  const cleaned = source
    .filter((item) => Boolean(item?.refId))
    .map((item) => ({
      ...item,
      id: item.id || buildItemId(item.type || 'sermon', item.refId),
      type: isKnownItemType(item.type) ? item.type : 'sermon',
      position: Number.isFinite(item.position) ? item.position : Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.position - b.position);

  return withSequentialPositions(cleaned);
};

export const deriveSermonIdsFromItems = (items: SeriesItem[]): string[] =>
  items.filter((item) => item.type === 'sermon').map((item) => item.refId);

export const inferSeriesKind = (items: SeriesItem[]): SeriesKind => {
  const hasSermons = items.some((item) => item.type === 'sermon');
  const hasGroups = items.some((item) => item.type === 'group');

  if (hasSermons && hasGroups) return 'mixed';
  if (hasGroups) return 'group';
  return 'sermon';
};

export const upsertSeriesItem = (
  items: SeriesItem[],
  payload: { type: SeriesItemType; refId: string; position?: number }
): SeriesItem[] => {
  const sanitized = normalizeSeriesItems(items);
  const withoutExisting = sanitized.filter(
    (item) => !(item.type === payload.type && item.refId === payload.refId)
  );

  const targetIndexRaw = payload.position === undefined ? withoutExisting.length : payload.position;
  const targetIndex = Math.min(Math.max(targetIndexRaw, 0), withoutExisting.length);

  withoutExisting.splice(targetIndex, 0, {
    id: buildItemId(payload.type, payload.refId),
    type: payload.type,
    refId: payload.refId,
    position: targetIndex + 1,
  });

  return withSequentialPositions(withoutExisting);
};

export const removeSeriesItemByRef = (
  items: SeriesItem[],
  payload: { type: SeriesItemType; refId: string }
): SeriesItem[] =>
  withSequentialPositions(
    normalizeSeriesItems(items).filter(
      (item) => !(item.type === payload.type && item.refId === payload.refId)
    )
  );

export const reorderSeriesItemsById = (items: SeriesItem[], orderedIds: string[]): SeriesItem[] => {
  const normalized = normalizeSeriesItems(items);
  const byId = new Map(normalized.map((item) => [item.id, item]));
  const reordered: SeriesItem[] = [];

  orderedIds.forEach((id) => {
    const match = byId.get(id);
    if (match) {
      reordered.push(match);
      byId.delete(id);
    }
  });

  for (const item of normalized) {
    if (byId.has(item.id)) {
      reordered.push(item);
    }
  }

  return withSequentialPositions(reordered);
};
