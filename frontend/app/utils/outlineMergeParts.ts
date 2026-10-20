/** Empty reminder/review values are the same authored value as an absent optional field. */
export function normalizeOutlineFields<T extends { note?: string; isReviewed?: boolean }>(item: T): T {
  const { note, isReviewed, ...rest } = item;
  return { ...rest, ...(note ? { note } : {}), ...(isReviewed ? { isReviewed } : {}) } as T;
}

/** The established outline order: the side that reordered leads; independent additions keep anchors. */
export function mergeOutlineOrder(base: readonly string[] | null, mine: readonly string[], theirs: readonly string[], wanted: ReadonlySet<string>): string[] {
  const unique = (ids: readonly string[]) => [...new Set(ids)];
  const b = unique(base ?? []), m = unique(mine), t = unique(theirs);
  const common = new Set(b.filter(id => m.includes(id) && t.includes(id)));
  const start = b.filter(id => common.has(id));
  const moved = (ids: readonly string[]) => ids.filter(id => common.has(id)).some((id,index) => id !== start[index]);
  const remoteLeads = base !== null && !moved(m) && moved(t);
  const leading = remoteLeads ? t : m, trailing = remoteLeads ? m : t;
  const result = leading.filter(id => wanted.has(id));
  const seen = new Set(result);
  trailing.forEach((id,index) => {
    if (!wanted.has(id) || seen.has(id)) return;
    let anchor = -1;
    for (let back=index-1;back>=0 && anchor<0;back-=1) anchor=result.indexOf(trailing[back]);
    if (anchor>=0) result.splice(anchor+1,0,id);
    else result.unshift(id);
    seen.add(id);
  });
  return result;
}
