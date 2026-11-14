/** A min-heap of the indices in the caller's preferred order. */
class ReadyIndices {
  private readonly items: number[] = [];

  add(index: number): void {
    const items = this.items;
    let position = items.length;
    items.push(index);
    while (position > 0) {
      const parent = Math.floor((position - 1) / 2);
      if (items[parent] <= index) break;
      items[position] = items[parent];
      position = parent;
    }
    items[position] = index;
  }

  takeFirst(): number | undefined {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (items.length === 0 || last === undefined) return first;
    let position = 0;
    while (position * 2 + 1 < items.length) {
      const left = position * 2 + 1, right = left + 1;
      const child = right < items.length && items[right] < items[left] ? right : left;
      if (last <= items[child]) break;
      items[position] = items[child];
      position = child;
    }
    items[position] = last;
    return first;
  }
}

/** Visit each edge once to count it and once to release it. Ready keys keep the caller's tie order. */
export function preferredTopologicalOrder(
  preferred: readonly string[], successors: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | null {
  const indexOf = new Map(preferred.map((key, index) => [key, index]));
  const incoming = preferred.map(() => 0);
  for (const targets of successors.values()) {
    for (const target of targets) incoming[indexOf.get(target)!] += 1;
  }
  const ready = new ReadyIndices();
  incoming.forEach((count, index) => {
    if (count === 0) ready.add(index);
  });

  const ordered: string[] = [];
  while (ordered.length < preferred.length) {
    const index = ready.takeFirst();
    if (index === undefined) return null;
    const key = preferred[index];
    ordered.push(key);
    for (const target of successors.get(key)!) {
      const targetIndex = indexOf.get(target)!;
      incoming[targetIndex] -= 1;
      if (incoming[targetIndex] === 0) ready.add(targetIndex);
    }
  }
  return ordered;
}
