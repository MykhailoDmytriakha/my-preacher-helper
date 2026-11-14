import { preferredTopologicalOrder } from '../preferredTopologicalOrder';

function orderByScanning(preferred: string[], edges: Map<string, Set<string>>): string[] | null {
  const pending = new Set(preferred), ordered: string[] = [];
  while (pending.size) {
    const next = preferred.find(key => pending.has(key) && ![...pending].some(other => edges.get(other)!.has(key)));
    if (next === undefined) return null;
    ordered.push(next);
    pending.delete(next);
  }
  return ordered;
}

it('matches the previous tie-breaking and cycle handling on every four-row graph', () => {
  const preferred = ['fourth', 'first', 'third', 'second'];
  const possible = preferred.flatMap(from => preferred.filter(to => to !== from).map(to => ({ from, to })));
  for (let graph = 0; graph < 2 ** possible.length; graph += 1) {
    const edges = new Map(preferred.map(key => [key, new Set<string>()]));
    possible.forEach(({ from, to }, index) => {
      if (graph & (1 << index)) edges.get(from)!.add(to);
    });
    expect(preferredTopologicalOrder(preferred, edges)).toEqual(orderByScanning(preferred, edges));
  }
});
