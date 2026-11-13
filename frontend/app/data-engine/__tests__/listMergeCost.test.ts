import { mergeFields } from '../protocol';


// White-box guard of the two hot spots BUG-20261112-list-merge-quadratic-order-rebuild measured: reads of the
// order graph's adjacency sets and scans of ID lists for membership. It does not catch a quadratic merge built
// from other primitives; it only keeps these two from coming back.
it.each([100, 200, 1000])('merges independent words in %i unchanged rows without rebuilding the order graph or scanning ID lists', count => {
  const base = Array.from({ length: count }, (_, index) => ({ id: 'row-' + index, text: 'base' }));
  const mine = base.map((row, index) => index === 0 ? { ...row, text: 'mine' } : row);
  const theirs = base.map((row, index) => index === count - 1 ? { ...row, text: 'theirs' } : row);
  let adjacencyReads = 0, membershipWork = 0;
  const get = Map.prototype.get, includes = Array.prototype.includes;
  Map.prototype.get = function(key) {
    const value = get.call(this, key);
    if (value instanceof Set) adjacencyReads++;
    return value;
  };
  Array.prototype.includes = function(value, fromIndex) {
    if (typeof value === 'string' && value.startsWith('id:row-')) membershipWork += this.length;
    return includes.call(this, value, fromIndex);
  };
  try {
    const merged = mergeFields({ exists: true, value: base }, { exists: true, value: mine },
      { exists: true, value: theirs }, ['thoughts']);
    expect(merged.conflicts).toEqual([]);
    expect(merged.value.value).toEqual(base.map((row, index) => ({ ...row,
      text: index === 0 ? 'mine' : index === count - 1 ? 'theirs' : 'base' })));
  } finally { Map.prototype.get = get; Array.prototype.includes = includes; }
  process.stdout.write(JSON.stringify({ count, adjacencyReads, membershipWork }) + '\n');
  expect(adjacencyReads).toBeLessThanOrEqual(3 * count);
  expect(membershipWork).toBeLessThanOrEqual(3 * count);
});

it.each([
  { before: ['a', 'b', 'c'], shared: ['c', 'a', 'b'] },
  { before: ['a', 'b', 'c'], shared: ['a', 'c'] },
  { before: ['a', 'b'], shared: ['a', 'x', 'b'] },
])('preserves a shared ID sequence $shared with independent word changes', ({ before, shared }) => {
  const rows = (ids: string[]) => ids.map(id => ({ id, text: 'base', note: 'base' }));
  const mine = rows(shared).map(row => before.includes(row.id) ? { ...row, text: 'mine' } : row);
  const theirs = rows(shared).map(row => before.includes(row.id) ? { ...row, note: 'theirs' } : row);
  // A shared insertion is identical; only existing rows have independent word changes.
  const merged = mergeFields({ exists: true, value: rows(before) }, { exists: true, value: mine }, { exists: true, value: theirs });
  expect(merged.value.value).toEqual(shared.map(id => ({ id, text: before.includes(id) ? 'mine' : 'base', note: before.includes(id) ? 'theirs' : 'base' })));
  expect(merged.conflicts).toEqual([]);
});
