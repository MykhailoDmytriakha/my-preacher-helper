import { lineDiff, reviewOf, type ChangeReader, type ChangeRow } from '../legacyCopyChanges';

// A reader that shows everything but references: an item in full is every field but its id and
// its `…Ref` parts, a value is its JSON without them; `unseen` returns exactly what it left out.
const isRef = (key: string) => key.endsWith('Ref');
const strip = (value: unknown): unknown => Array.isArray(value) ? value.map(strip)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !isRef(key)).map(([key, part]) => [key, strip(part)])) : value;
const unseen = (value: unknown): unknown => {
  if (Array.isArray(value)) { const inner = value.map(unseen); return inner.some(part => part !== undefined) ? inner : undefined; }
  if (!value || typeof value !== 'object') return undefined;
  const parts = Object.entries(value).flatMap(([key, part]): [string, unknown][] => isRef(key) ? [[key, part]] : unseen(part) === undefined ? [] : [[key, unseen(part)]]);
  return parts.length ? Object.fromEntries(parts) : undefined;
};
const read: ChangeReader = {
  item: item => String(item.text ?? item.title ?? item.id),
  entry: item => Object.entries(item).filter(([key]) => key !== 'id' && !isRef(key)).map(([key, value]) => (key === 'text' || key === 'title' ? String(value) : `${key}: ${JSON.stringify(strip(value))}`)),
  value: (_field, value) => (typeof value === 'string' ? value.split('\n') : [JSON.stringify(strip(value))]),
  label: field => field,
  unseen,
};
const shape = (rows: ChangeRow[]) => rows.map(row => ('context' in row ? { context: row.context } : { [row.change.kind]: [row.change.device, row.change.server] }));

describe('a copy read as a review of changes', () => {
  const stone = { id: 't1', text: 'The stone was rolled away so the disciples could go in.' };
  const women = { id: 't2', text: 'The women came asking who would roll the stone.' };
  const tomb = { id: 't3', text: 'The empty tomb is where the sermon begins.' };

  it('lays a list of thoughts out item by item: removed where the device had it, added, unchanged between', () => {
    const device = { thoughts: [stone, women] }, server = { thoughts: [women, tomb] };
    const { fields: [field], hidden } = reviewOf('sermons', device, server, [{ field: 'thoughts', device: device.thoughts, server: server.thoughts }], read);
    expect(shape(field.rows)).toEqual([
      { removed: [[stone.text], []] },
      { context: [women.text] },
      { added: [[], [tomb.text]] },
    ]);
    expect(hidden).toEqual([]);
  });

  it('shows an item only one side has in full, every part that holds words', () => {
    const camp = { id: 'm1', title: 'Camp', summary: 'Unsent explanation', decision: 'Unsent decision' };
    const { fields: [field] } = reviewOf('councils', {}, {}, [{ field: 'topics', device: [camp], server: [] }], read);
    expect(shape(field.rows)).toEqual([{ removed: [['Camp', 'summary: "Unsent explanation"', 'decision: "Unsent decision"'], []] }]);
  });

  it('keys a decision by what the change says, so a different change is never decided by it', () => {
    const review = (server: string) => reviewOf('series', {}, {}, [{ field: 'note', device: 'a\nmid\nb', server }], read);
    const first = review('A\nmid\nb').fields[0].rows.flatMap(row => ('change' in row ? [row.change.key] : []));
    const later = review('a\nmid\nB').fields[0].rows.flatMap(row => ('change' in row ? [row.change.key] : []));
    expect(first).toHaveLength(1);
    expect(later).toHaveLength(1);
    expect(later[0]).not.toBe(first[0]);
    expect(review('A\nmid\nb').fields[0].rows.flatMap(row => ('change' in row ? [row.change.key] : []))).toEqual(first);
  });

  it('leaves out sermon sections whose only change is the thoughts already shown', () => {
    const device = { thoughts: [stone, women] }, server = { thoughts: [women, tomb] };
    const explained = { field: 'structure', device: { introduction: ['t1', 't2'] }, server: { introduction: ['t2', 't3'] } };
    expect(reviewOf('sermons', device, server, [explained], read)).toEqual({ fields: [], hidden: [] });
  });

  it('reads shared thoughts that moved as text, and keeps an id no thought explains', () => {
    const device = { thoughts: [stone, women] }, server = { thoughts: [stone, women] };
    const moved = { field: 'structure', device: { introduction: ['t2', 'orphan'], main: [] }, server: { introduction: [], main: ['t2'] } };
    const { fields: [field] } = reviewOf('sermons', device, server, [moved], read);
    expect(JSON.stringify(field.rows)).toContain(women.text);
    expect(JSON.stringify(field.rows)).toContain('orphan');
  });

  it('names a difference no line shows as hidden instead of dropping it: a reorder, a swap of thoughts that read alike', () => {
    const a = { id: 'm1', title: 'A' }, b = { id: 'm2', title: 'B' };
    expect(reviewOf('councils', {}, {}, [{ field: 'topics', device: [a, b], server: [b, a] }], read)).toEqual({ fields: [], hidden: ['topics'] });
    const twinA = { id: 'x', text: 'Same words' }, twinB = { id: 'y', text: 'Same words' };
    const side = { thoughts: [twinA, twinB] };
    const swapped = { field: 'structure', device: { introduction: ['x'], main: ['y'] }, server: { introduction: ['y'], main: ['x'] } };
    expect(reviewOf('sermons', side, side, [swapped], read).hidden).toEqual(['structure']);
  });

  it('names a list hidden when an item that leaves has no line to read it by, beside a visible change', () => {
    const blank = { id: 'm1', placeRef: 'p1' }, edited = { id: 'm2', title: 'B' };
    const review = reviewOf('councils', {}, {}, [{ field: 'topics', device: [blank, edited], server: [{ ...edited, title: 'B2' }] }], read);
    expect(review.fields).toHaveLength(1);
    expect(review.hidden).toEqual(['topics']);
  });

  it('names a field hidden when a part its lines leave out differs beside a visible change', () => {
    const before = { id: 'm1', title: 'Camp', decision: 'Old', details: { placeRef: 'a', note: 'same' } };
    const after = { ...before, decision: 'New', details: { placeRef: 'b', note: 'same' } };
    const keyed = reviewOf('councils', {}, {}, [{ field: 'topics', device: [before], server: [after] }], read);
    expect(keyed.fields).toHaveLength(1);
    expect(keyed.hidden).toEqual(['topics']);
    const plainObject = reviewOf('series', {}, {}, [{ field: 'meta', device: { label: 'x', placeRef: 'a' }, server: { label: 'y', placeRef: 'b' } }], read);
    expect(plainObject.fields).toHaveLength(1);
    expect(plainObject.hidden).toEqual(['meta']);
  });

  it('names sermon sections hidden when thoughts that read alike change places beside a visible change', () => {
    const twinA = { id: 'x', text: 'Same' }, twinB = { id: 'y', text: 'Same' };
    const side = { thoughts: [twinA, twinB] };
    const mixed = { field: 'structure', device: { introduction: ['x', 'orphan'], main: ['y'] }, server: { introduction: ['y'], main: ['x'] } };
    const review = reviewOf('sermons', side, side, [mixed], read);
    expect(JSON.stringify(review.fields)).toContain('orphan');
    expect(review.hidden).toEqual(['structure']);
  });

  it('names a list hidden in part when a visible change comes with a reorder of the rest', () => {
    const a = { id: 'm1', title: 'A' }, b = { id: 'm2', title: 'B' }, c = { id: 'm3', title: 'C' };
    const review = reviewOf('councils', {}, {}, [{ field: 'topics', device: [a, b], server: [b, a, c] }], read);
    expect(review.fields).toHaveLength(1);
    expect(review.hidden).toEqual(['topics']);
  });

  it('keeps the same words changed twice in one text as two changes with their own keys', () => {
    const { fields: [field] } = reviewOf('studyNotes', {}, {}, [{ field: 'content', device: 'x\nkeep\nx', server: 'y\nkeep\ny' }], read);
    const keys = field.rows.flatMap(row => ('change' in row ? [row.change.key] : []));
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('names a changed list item by this device and shows only its fields that differ', () => {
    const camp = { id: 'm1', title: 'Summer camp', decision: 'Carry it to the next council', questions: [] };
    const decided = { ...camp, decision: 'Hold it on July 20–24', updatedAt: 'later' };
    const { fields: [field] } = reviewOf('councils', {}, {}, [{ field: 'topics', device: [camp], server: [decided] }], read);
    expect(shape(field.rows)).toEqual([{ replaced: [['decision: Carry it to the next council'], ['decision: Hold it on July 20–24']] }]);
    expect('change' in field.rows[0] && field.rows[0].change.subject).toBe('Summer camp');
  });

  it('reads an item part only this device held as removed, not as replaced by nothing', () => {
    const report = { id: 'm2', title: 'Camp report', questions: [] };
    const withDecision = { ...report, decision: 'Carry it to the next council' };
    const { fields: [field] } = reviewOf('councils', {}, {}, [{ field: 'topics', device: [withDecision], server: [report] }], read);
    expect(shape(field.rows)).toEqual([{ removed: [['decision: Carry it to the next council'], []] }]);
  });

  it('shows a single value as one change, and a value only one side has as added or removed', () => {
    const { fields } = reviewOf('users', {}, {}, [
      { field: 'firstDayOfWeek', device: 'sunday', server: 'monday' },
      { field: 'showAppVersion', device: undefined, server: true },
      { field: 'displayName', device: 'Pastor', server: undefined },
    ], read);
    expect(fields.map(({ rows }) => shape(rows))).toEqual([
      [{ replaced: [['sunday'], ['monday']] }],
      [{ added: [[], ['true']] }],
      [{ removed: [['Pastor'], []] }],
    ]);
  });

  it('cuts a text into separate changes around the lines both sides share', () => {
    const device = 'Intro\nOld middle\nShared\nGone line\nEnd';
    const server = 'Intro\nNew middle\nShared\nEnd\nAdded line';
    const { fields: [field] } = reviewOf('studyNotes', {}, {}, [{ field: 'content', device, server }], read);
    expect(shape(field.rows)).toEqual([
      { context: ['Intro'] },
      { replaced: [['Old middle'], ['New middle']] },
      { context: ['Shared'] },
      { removed: [['Gone line'], []] },
      { context: ['End'] },
      { added: [[], ['Added line']] },
    ]);
  });

  it('compares a list of plain values value by value', () => {
    const { fields: [field] } = reviewOf('studyNotes', {}, {}, [{ field: 'tags', device: ['hope', 'grace'], server: ['grace', 'faith'] }], read);
    expect(shape(field.rows)).toEqual([{ removed: [['hope'], []] }, { context: ['grace'] }, { added: [[], ['faith']] }]);
  });
});

describe('line diff of a structured difference', () => {
  it('keeps changed lines with two lines of context and folds the unchanged rest', () => {
    const lines = (changed: string) => ['a', 'b', 'c', 'd', 'e', changed, 'f', 'g', 'h', 'i'].join('\n');
    expect(lineDiff(lines('old'), lines('new'))).toEqual([
      { gap: 3 }, { op: ' ', text: 'd' }, { op: ' ', text: 'e' }, { op: '-', text: 'old' }, { op: '+', text: 'new' },
      { op: ' ', text: 'f' }, { op: ' ', text: 'g' }, { gap: 2 },
    ]);
  });

  it('shows added and removed lines where they belong', () => {
    expect(lineDiff('x\ny', 'x\nz\ny')).toEqual([{ op: ' ', text: 'x' }, { op: '+', text: 'z' }, { op: ' ', text: 'y' }]);
    expect(lineDiff('x\nz\ny', 'x\ny')).toEqual([{ op: ' ', text: 'x' }, { op: '-', text: 'z' }, { op: ' ', text: 'y' }]);
  });
});
