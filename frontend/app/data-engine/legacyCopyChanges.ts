/**
 * A COPY'S DIFFERENCES AS A REVIEW OF CHANGES.
 *
 * What this device held against what the app holds now, laid out the way `git diff` lays out
 * hunks: every change stands on its own — added (only in the app), removed (only on this device)
 * or replaced (one became the other) — with the unchanged lines between them. Lists whose items
 * carry an id (thoughts, council matters, prayer updates) are compared item by item, lists of
 * plain values value by value, text and structured values line by line; anything else is one
 * change. The screen only draws what this returns; how a value reads is the reader's business.
 *
 * A review never claims more than it shows: a difference that produced no change the person can
 * see — a list only reordered, values that read alike, an item or a part the reader leaves out —
 * is named in `hidden`. A review decides nothing by itself: a copy leaves the device only when the
 * person removes it.
 */

/** Fields that record when and how a copy was written, never what the person wrote. */
export const BOOKKEEPING: ReadonlySet<string> = new Set(['updatedAt', 'createdAt', 'rev', '_dataEngine', '_dataEngineOwner']);

export type ChangeKind = 'added' | 'removed' | 'replaced';

export interface Change {
  /** The change's own content: a decision about it does not carry over to a different change. */
  key: string;
  kind: ChangeKind;
  /** The list item the change belongs to, as this device names it (a council matter's title). */
  subject?: string;
  /** Lines only this device held. */
  device: string[];
  /** Lines the app holds now. */
  server: string[];
}

export type ChangeRow = { context: string[] } | { change: Change };

export interface FieldChanges { field: string; rows: ChangeRow[] }

export interface Review {
  fields: FieldChanges[];
  /** Fields that differ in a way no line shows: what they hold is only in the raw copy. */
  hidden: string[];
}

export interface ChangeReader {
  /** A list item by the words the person knows it by: a thought's text, a matter's title. */
  item: (item: Record<string, unknown>) => string;
  /** A list item in full: its name first, then every other part that holds words. */
  entry: (item: Record<string, unknown>) => string[];
  /** Any other value of a field as the lines it reads in. */
  value: (field: string, value: unknown) => string[];
  /** A field's name in the person's words. */
  label: (field: string) => string;
  /** The parts of a value its lines leave out (references, a list item's placement); `undefined` when none. */
  unseen: (value: unknown) => unknown;
}

export interface Difference { field: string; device: unknown; server: unknown }

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * A value as comparison reads it: keys in one order, bookkeeping left out. `withoutOwnId` also
 * leaves out the document's own id, which a cached row and its server copy name differently.
 */
export const canonical = (value: unknown, withoutOwnId = false): unknown => {
  if (Array.isArray(value)) return value.map(item => canonical(item));
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key => !BOOKKEEPING.has(key) && !(withoutOwnId && key === 'id'))
    .map(key => [key, canonical(value[key])]));
};
const same = (left: unknown, right: unknown) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

/** One text for a value however its fields happen to be ordered: what a decision is bound to. */
export const fingerprint = (value: unknown): string => JSON.stringify(canonical(value)) ?? '';

type Op = { op: ' ' | '-' | '+'; text: string };

/** Longest common subsequence of lines, as git shows a replacement: the old line first, then the new one. */
export function lineOps(device: readonly string[], server: readonly string[]): Op[] {
  const a = device, b = server;
  const ops: Op[] = [];
  if (a.length * b.length > 250_000) {
    return [...a.map(text => ({ op: '-' as const, text })), ...b.map(text => ({ op: '+' as const, text }))];
  }
  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i * width + j] = a[i] === b[j] ? common[(i + 1) * width + j + 1] + 1
        : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { ops.push({ op: ' ', text: a[i] }); i += 1; j += 1; }
    else if (i < a.length && (j === b.length || common[(i + 1) * width + j] >= common[i * width + j + 1])) { ops.push({ op: '-', text: a[i] }); i += 1; }
    else { ops.push({ op: '+', text: b[j] }); j += 1; }
  }
  return ops;
}

export type DiffRow = { op: ' ' | '-' | '+'; text: string } | { gap: number };

/**
 * A unified line diff, as `git diff` shows it: changed lines with two lines of context, the
 * unchanged rest folded. Very large texts show both sides whole, still correct, only less compact.
 */
export function lineDiff(device: string, server: string, context = 2): DiffRow[] {
  const ops = lineOps(device.split('\n'), server.split('\n'));
  const near = ops.map((_, index) => ops.slice(Math.max(0, index - context), index + context + 1).some(entry => entry.op !== ' '));
  const rows: DiffRow[] = [];
  ops.forEach((entry, index) => {
    if (entry.op !== ' ' || near[index]) { rows.push(entry); return; }
    const last = rows[rows.length - 1];
    if (last && 'gap' in last) last.gap += 1; else rows.push({ gap: 1 });
  });
  return rows;
}

const kindOf = (device: readonly string[], server: readonly string[]): ChangeKind =>
  device.length && server.length ? 'replaced' : device.length ? 'removed' : 'added';

type Side = Omit<Change, 'key' | 'kind'>;
/** A changed item's lines, and whether a part of its difference shows in none of them. */
type ChangedSide = Side & { unseen?: boolean };

/** Collects context lines and changes in order; consecutive context shares one row. */
class Rows {
  readonly rows: ChangeRow[] = [];
  constructor(private readonly field: string) {}
  context(line: string) {
    const last = this.rows[this.rows.length - 1];
    if (last && 'context' in last) last.context.push(line); else this.rows.push({ context: [line] });
  }
  /** The key is what the change says — field, kind, item and both sides — never its position. */
  change(side: Side, item?: string) {
    if (!side.device.length && !side.server.length) return;
    const kind = kindOf(side.device, side.server);
    const said = JSON.stringify([this.field, kind, item ?? null, side.device, side.server]);
    // The same words changed twice in one text are two changes: each keeps its own decision.
    const seen = this.rows.filter(row => 'change' in row && row.change.key.startsWith(said.slice(0, -1))).length;
    this.rows.push({ change: { key: seen ? `${said.slice(0, -1)},${seen}]` : said, kind, ...side } });
  }
  /** A part of the difference no line shows: the field is named hidden. */
  hidden = false;
}

/** Lines against lines: each run of changed lines between unchanged ones is one change. */
function textRows(field: string, device: readonly string[], server: readonly string[]): Rows {
  const rows = new Rows(field);
  let removed: string[] = [], added: string[] = [];
  const flush = () => {
    rows.change({ device: removed, server: added });
    removed = []; added = [];
  };
  for (const entry of lineOps(device, server)) {
    if (entry.op === ' ') { flush(); rows.context(entry.text); }
    else if (entry.op === '-') removed.push(entry.text);
    else added.push(entry.text);
  }
  flush();
  return rows;
}

/**
 * Two lists of the same things, keyed: the app's order, with what only this device held standing
 * where the device had it — before the next item both sides share.
 */
function keyedRows<T>(field: string, device: readonly T[], server: readonly T[], keyOf: (item: T) => string,
  describe: { same: (item: T) => string; removed: (item: T) => Side; added: (item: T) => Side; changed: (device: T, server: T) => ChangedSide }): Rows {
  const onServer = new Set(server.map(keyOf));
  const deviceByKey = new Map(device.map(item => [keyOf(item), item]));
  const waiting = new Map<string, T[]>();
  let pending: T[] = [];
  for (const item of device) {
    const key = keyOf(item);
    if (onServer.has(key)) { if (pending.length) waiting.set(key, pending); pending = []; }
    else pending.push(item);
  }
  const rows = new Rows(field);
  // The device's order of the items both sides share is the person's arrangement too.
  const sharedOrder = (list: readonly T[]) => list.map(keyOf).filter(key => onServer.has(key) && deviceByKey.has(key));
  if (sharedOrder(device).join('\u0000') !== sharedOrder(server).join('\u0000')) rows.hidden = true;
  // An item that leaves or arrives with no line to read by is still a difference: named, not dropped.
  const whole = (side: Side, key: string) => {
    if (!side.device.length && !side.server.length) rows.hidden = true; else rows.change(side, key);
  };
  const removedRow = (item: T) => whole(describe.removed(item), keyOf(item));
  for (const item of server) {
    const key = keyOf(item);
    (waiting.get(key) ?? []).forEach(removedRow);
    const held = deviceByKey.get(key);
    if (held === undefined) whole(describe.added(item), key);
    else if (same(held, item)) rows.context(describe.same(item));
    // An item whose changed part only one side has reads as that part added or removed.
    else {
      const changed = describe.changed(held, item);
      if (changed.unseen) rows.hidden = true;
      // A part that differs yet reads the same on both sides is not shown by any line.
      if (changed.device.join('\n') === changed.server.join('\n')) rows.hidden = true; else rows.change(changed, key);
    }
  }
  pending.forEach(removedRow);
  return rows;
}

const itemId = (item: unknown): string | null => object(item) && typeof item.id === 'string' && item.id ? item.id : null;
const keyedById = (list: readonly unknown[]): list is Row[] => {
  const ids = list.map(itemId);
  return ids.every(Boolean) && new Set(ids).size === ids.length;
};
const plain = (value: unknown): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value);
const keyedByValue = (list: readonly unknown[]): boolean => list.every(plain) && new Set(list.map(String)).size === list.length;

/**
 * The lines a changed item reads in: only its fields that differ, each under its name — and
 * whether one of them also differs in a part its lines leave out.
 */
function changedItem(device: Row, server: Row, read: ChangeReader): ChangedSide {
  const fields = [...new Set([...Object.keys(device), ...Object.keys(server)])].sort()
    .filter(key => key !== 'id' && !BOOKKEEPING.has(key) && !same(device[key], server[key]));
  const labelled = (side: Row) => fields.flatMap(key => {
    const lines = side[key] === undefined || side[key] === null ? [] : read.value(key, side[key]);
    return lines.length ? [`${read.label(key)}: ${lines[0]}`, ...lines.slice(1)] : [];
  });
  const unseen = fields.some(key => !same(read.unseen(device[key]), read.unseen(server[key])));
  return { subject: read.item(device), device: labelled(device), server: labelled(server), unseen };
}

const SECTIONS = ['structure', 'thoughtsBySection'];

/**
 * A sermon's sections list thought ids. A thought only one side has already shows as its own
 * change, so its id says nothing new here; every other placement — shared thoughts moved, an id
 * no thought explains — still counts, and reads as thought text where there is one. Two thoughts
 * that read alike cannot be told apart by their text, so a placement of theirs is named unseen.
 * `null` when the sections differ only by thoughts already shown.
 */
function sectionsAsText(device: Row, server: Row, field: string, deviceValue: unknown, serverValue: unknown): [unknown, unknown, boolean] | null {
  if (!SECTIONS.includes(field) || !object(deviceValue) || !object(serverValue)) return [deviceValue, serverValue, false];
  const idsOf = (side: Row) => new Map((Array.isArray(side.thoughts) ? side.thoughts : []).flatMap(thought => {
    const id = itemId(thought);
    return id ? [[id, typeof (thought as Row).text === 'string' ? (thought as Row).text as string : id] as const] : [];
  }));
  const mine = idsOf(device), theirs = idsOf(server);
  const explained = new Set([...mine.keys(), ...theirs.keys()].filter(id => mine.has(id) !== theirs.has(id)));
  const texts = new Map([...mine, ...theirs]);
  const kept = (value: Row) => Object.fromEntries(Object.entries(value).map(([section, ids]) =>
    [section, Array.isArray(ids) ? ids.filter(id => typeof id !== 'string' || !explained.has(id)) : ids]));
  const deviceKept = kept(deviceValue), serverKept = kept(serverValue);
  if (same(deviceKept, serverKept)) return null;
  const readable = (value: Row) => Object.fromEntries(Object.entries(value).map(([section, ids]) =>
    [section, Array.isArray(ids) ? ids.map(id => (typeof id === 'string' ? texts.get(id) ?? id : id)) : ids]));
  const placed = new Set([deviceKept, serverKept].flatMap(value => Object.values(value).flatMap(ids =>
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])));
  const readAs = [...placed].map(id => texts.get(id) ?? id);
  return [readable(deviceKept), readable(serverKept), new Set(readAs).size < readAs.length];
}

/** One field's difference as rows of context and changes, and whether a part of it shows in no line. */
function fieldRows(field: string, device: unknown, server: unknown, read: ChangeReader): Rows {
  if (Array.isArray(device) && Array.isArray(server)) {
    if (keyedById(device) && keyedById(server)) {
      return keyedRows(field, device, server, item => itemId(item)!, {
        same: item => read.item(item),
        removed: item => ({ device: read.entry(item), server: [] }),
        added: item => ({ device: [], server: read.entry(item) }),
        changed: (held, now) => changedItem(held, now, read),
      });
    }
    if (keyedByValue(device) && keyedByValue(server)) {
      const line = (value: unknown) => read.value(field, value).join(' ');
      return keyedRows(field, device, server, String, {
        same: line, removed: value => ({ device: [line(value)], server: [] }),
        added: value => ({ device: [], server: [line(value)] }), changed: (held, now) => ({ device: [line(held)], server: [line(now)] }),
      });
    }
  }
  const deviceLines = device === undefined || device === null ? [] : read.value(field, device);
  const serverLines = server === undefined || server === null ? [] : read.value(field, server);
  // A value that reads in one line on both sides is one change, never a line-by-line patchwork.
  // A part of the value its lines leave out that differs is shown by no line either.
  const unseen = !same(read.unseen(device), read.unseen(server));
  if (deviceLines.length <= 1 && serverLines.length <= 1) {
    const rows = new Rows(field);
    if (deviceLines.join('\n') === serverLines.join('\n')) rows.hidden = true;
    else rows.change({ device: deviceLines, server: serverLines });
    rows.hidden ||= unseen;
    return rows;
  }
  const rows = textRows(field, deviceLines, serverLines);
  rows.hidden ||= unseen;
  return rows;
}

/**
 * Every differing field of a copy as a review of changes. `device` and `server` are the whole rows,
 * read as the person wrote them; `differences` the fields that differ between them. A field whose
 * difference shows as no change at all is named in `hidden` instead of being dropped.
 */
export function reviewOf(collection: string, device: Row, server: Row, differences: readonly Difference[], read: ChangeReader): Review {
  const fields: FieldChanges[] = [];
  const hidden: string[] = [];
  for (const { field, device: mine, server: theirs } of differences) {
    const pair = collection === 'sermons' ? sectionsAsText(device, server, field, mine, theirs) : [mine, theirs, false] as const;
    if (!pair) continue;
    const { rows, hidden: unseen } = fieldRows(field, pair[0], pair[1], read);
    if (rows.some(row => 'change' in row)) fields.push({ field, rows });
    // Every difference that changed no line, whole or in part, is named: nothing leaves unseen.
    if (unseen || pair[2] || !rows.some(row => 'change' in row)) hidden.push(field);
  }
  return { fields, hidden };
}
