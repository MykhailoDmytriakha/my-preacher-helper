import { serializeContent } from '@/utils/contentFingerprint';
import { mergeOutlineOrder, normalizeOutlineFields } from '@/utils/outlineMergeParts';

import type { FieldValue, Json } from '@/data-engine/types';
import type { OutlinePoint, SermonOutline, SubPoint } from '@/models/models';

type OutlineFieldMerger = (base: FieldValue, mine: FieldValue, theirs: FieldValue) => { value: FieldValue };

type Section = keyof SermonOutline;
type Home = readonly ['section', Section] | readonly ['point', string];
type Fields = Record<string, unknown>;
interface Entry { home: Home; fields: Fields; full: Fields }
interface Side { entries: Map<string, Entry>; orders: Map<string, string[]>; subLists: Set<string> }
const sections: Section[] = ['introduction', 'main', 'conclusion'];
const homeKey = (home: Home) => JSON.stringify(home);
const equal = (a: unknown, b: unknown) => serializeContent(a) === serializeContent(b);

/** Ambiguous old identities cannot authorize an automatic scoped replacement. */
export class OutlineChoiceReviewRequiredError extends Error {
  constructor() {
    super('The saved structure needs a whole-version review before replacement');
    this.name = 'OutlineChoiceReviewRequiredError';
  }
}

function ownFields(value: OutlinePoint | SubPoint): Fields {
  const { subPoints: _children, position: _position, ...fields } = value as OutlinePoint & SubPoint;
  return JSON.parse(JSON.stringify(normalizeOutlineFields(fields)));
}

function index(outline: SermonOutline | null | undefined): Side {
  const answer: Side = { entries: new Map(), orders: new Map(), subLists: new Set() };
  const add = (id: string, entry: Entry) => {
    if (typeof id !== 'string' || !id || answer.entries.has(id)) throw new OutlineChoiceReviewRequiredError();
    answer.entries.set(id, entry);
  };
  for (const section of sections) {
    const points = outline?.[section] ?? [];
    answer.orders.set(homeKey(['section', section]), points.map(point => point.id));
    for (const point of points) {
      const subs = [...(point.subPoints ?? [])].sort((a,b) => a.position - b.position);
      const fields = ownFields(point);
      if (point.subPoints !== undefined) answer.subLists.add(point.id);
      add(point.id, {home: ['section',section],fields,full: {...fields,subPoints:subs.map(ownFields)}});
      answer.orders.set(homeKey(['point',point.id]),subs.map(sub => sub.id));
      for (const sub of subs) {
        const subFields = ownFields(sub);
        add(sub.id,{home:['point',point.id],fields:subFields,full:subFields});
      }
    }
  }
  return answer;
}

/** A relative-order edit is intent too, including when the other copy deleted that item. */
function movedInList(id: string, base: Side, mine: Side, home: Home): boolean {
  const key = homeKey(home), b = base.orders.get(key) ?? [], m = mine.orders.get(key) ?? [];
  const before = b.indexOf(id), after = m.indexOf(id);
  return before >= 0 && after >= 0 && b.some((other,at) => m.includes(other)
    && Math.sign(at-before) !== Math.sign(m.indexOf(other)-after));
}

/**
 * A deliberate choice of this side's changes, not its whole old snapshot. Each id owns its fields
 * and one home independently; untouched remote words survive a local move, deletion or rewrite.
 * The ordinary writer still merges this result against the shown server snapshot, so a later
 * unknown conflict is a new question. This function never grants permission over a later copy.
 */
export function chooseOutlineChanges(base: SermonOutline | null | undefined, mine: SermonOutline,
  theirs: SermonOutline | null | undefined, merge: OutlineFieldMerger): SermonOutline {
  const b=index(base), m=index(mine), t=index(theirs), chosen=new Map<string,{home:Home;fields:Fields}>();
  for (const id of new Set([...m.entries.keys(),...t.entries.keys()])) {
    const start=b.entries.get(id), here=m.entries.get(id), there=t.entries.get(id);
    if (!here) {
      // This person's explicit deletion stays deleted even if the other device moved the id.
      if (!start && there) chosen.set(id,{home:there.home,fields:there.fields});
      continue;
    }
    if (!there) {
      const changed = !start || !equal(here.home,start.home) || !equal(here.full,start.full)
        || movedInList(id,b,m,here.home);
      if (changed) chosen.set(id,{home:here.home,fields:here.fields});
      continue;
    }
    const field = (entry: Entry | undefined) => entry ? {exists:true as const,value:entry.fields as Json} : {exists:false as const};
    const fields = merge(field(start),field(here),field(there)).value.value as Fields;
    const home = start && equal(here.home,start.home) ? there.home : here.home;
    chosen.set(id,{home,fields});
  }

  // Deleting a parent deliberately removes its still-nested children. A mixed conversion that
  // would make a sub-point itself a parent cannot be guessed into this two-level structure.
  for (const [id,entry] of chosen) {
    if (entry.home[0] !== 'point') continue;
    const parent=chosen.get(entry.home[1]);
    if (!parent) chosen.delete(id);
    else if (parent.home[0] !== 'section') throw new OutlineChoiceReviewRequiredError();
  }
  const order = (home:Home) => {
    const key=homeKey(home), wanted=new Set([...chosen].filter(([,entry]) => equal(entry.home,home)).map(([id]) => id));
    return mergeOutlineOrder(base ? b.orders.get(key) ?? [] : null,m.orders.get(key) ?? [],t.orders.get(key) ?? [],wanted);
  };
  const output: SermonOutline = {introduction:[],main:[],conclusion:[]};
  for (const section of sections) {
    output[section]=order(['section',section]).map(id => {
      const point={...chosen.get(id)!.fields} as unknown as OutlinePoint;
      const subs=order(['point',id]).map((subId,at) => ({...chosen.get(subId)!.fields,position:at+1}) as unknown as SubPoint);
      if (subs.length || b.subLists.has(id) || m.subLists.has(id) || t.subLists.has(id)) point.subPoints=subs;
      return point;
    });
  }
  return output;
}
