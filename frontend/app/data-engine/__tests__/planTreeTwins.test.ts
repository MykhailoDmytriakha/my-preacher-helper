import { applyCommand, diffFields, mergeDocumentFields } from '../protocol';
import { DataSession } from '../session';

import type { DataCommand, DocumentData, Json, ResourceSnapshot } from '../types';

// BUG-20261011-plan-tree-move-merge-duplicates: lists of the exegetical plan merge one by one, so a point
// moved to one place on one device and to another place on a second device landed in both, quietly. A point
// lives once in the plan: a merge that would hold it twice is a conflict on the plan whose own version keeps the
// point once, where this device put it, with everything else both devices did. A twin already held blocks nothing.
const ref = { collection: 'sermons', id: 'sermon-1' };
const metadata = (revision: number) => ({ protocol: 1 as const, generation: 'g1', revision, deleted: false });
const snapshot = (value: DocumentData, revision = 1): ResourceSnapshot => ({ resource: ref, value, metadata: metadata(revision) });
const update = (base: DocumentData, next: DocumentData): DataCommand => ({
  protocol: 1, operationId: 'operation-1', owner: 'owner', resource: ref, generation: 'g1',
  dependsOn: [], kind: 'update', changes: diffFields(base, next),
});
const node = (id: string, children?: Json[], extra: DocumentData = {}): DocumentData =>
  ({ id, title: id, ...(children ? { children } : {}), ...extra });
const sermon = (plan: Json[], extra: DocumentData = {}): DocumentData =>
  ({ userId: 'owner', title: 'Sermon', preparation: { exegeticalPlan: plan, authorIntent: 'intent' }, ...extra });
// The plan as the person sees it: an empty list of sub-points is the same as none.
const shape = (nodes: Json[]): Json[] => nodes.map(item => {
  const { children, ...rest } = item as DocumentData;
  return Array.isArray(children) && children.length ? { ...rest, children: shape(children) } : rest;
});
const planOf = (doc: DocumentData | null | undefined): Json[] =>
  shape(((doc?.preparation as DocumentData | undefined)?.exegeticalPlan ?? []) as Json[]);
const pointIds = (nodes: Json[], found: string[] = []): string[] => {
  for (const item of nodes) {
    const entry = item as DocumentData;
    found.push(String(entry.id));
    pointIds((entry.children ?? []) as Json[], found);
  }
  return found;
};

// The plan P → [Y, X]; one device lifts X to the top, the other puts it under Y.
const base = sermon([node('P', [node('Y'), node('X')])]);
const lifted = sermon([node('P', [node('Y')]), node('X')]);
const nested = sermon([node('P', [node('Y', [node('X')])])]);

describe('a point of the exegetical plan moved to different places on two devices', () => {
  it('is a conflict on the whole plan that offers this device\'s plan, not the point twice', () => {
    const result = mergeDocumentFields(base, lifted, nested);
    expect(result.conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan']]);
    expect(planOf(result.value.value as DocumentData)).toEqual(planOf(lifted));
  });

  it('comes back from the server as a conflict instead of being stored twice', () => {
    const result = applyCommand(update(base, lifted), snapshot(nested, 2));
    expect(result.kind).toBe('conflict');
  });

  it('keeps every other field the two devices changed out of the plan', () => {
    const result = mergeDocumentFields(base, { ...lifted, title: 'Mine' },
      { ...nested, preparation: { ...(nested.preparation as DocumentData), authorIntent: 'theirs' } });
    const value = result.value.value as DocumentData;
    expect(value.title).toBe('Mine');
    expect((value.preparation as DocumentData).authorIntent).toBe('theirs');
    expect(result.conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan']]);
  });

  it('is still a conflict on the plan when another field conflicts too', () => {
    const result = mergeDocumentFields({ ...base, title: 'base' }, { ...lifted, title: 'mine' }, { ...nested, title: 'theirs' });
    expect(result.conflicts.map(conflict => conflict.path)).toEqual(expect.arrayContaining([['title'], ['preparation', 'exegeticalPlan']]));
    expect(pointIds(planOf(result.value.value as DocumentData)).filter(id => id === 'X')).toHaveLength(1);
  });

  it('leaves no twin in what it keeps when the other device moved another point too', () => {
    const start = sermon([node('G1', [node('X'), node('Z')]), node('G2', []), node('W')]);
    const mine = sermon([node('G1', [node('Z')]), node('G2', []), node('W', [node('X')])]);
    const theirs = sermon([node('G1', []), node('G2', [node('Z', [node('X')])]), node('W')]);
    const ids = pointIds(planOf(mergeDocumentFields(start, mine, theirs).value.value as DocumentData));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lets this device keep its plan: "keep mine" saves it with the point once', () => {
    const device = new DataSession(snapshot(base));
    device.edit(lifted);
    const sent = device.prepare('mine-1', 'owner')!;
    const server = snapshot(nested, 2);
    const answer = applyCommand(sent, server);
    device.accept(answer);
    expect(device.getState().conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan']]);
    device.release('mine-1');
    device.keepLocal();
    const resent = device.prepare('mine-2', 'owner')!;
    const saved = applyCommand(resent, server);
    expect(saved.kind).toBe('acknowledged');
    if (saved.kind !== 'acknowledged') throw new Error('Expected acknowledgement');
    expect(planOf(saved.snapshot.value)).toEqual(planOf(lifted));
  });

  it('lets this device take the other plan: "use the arrived version" keeps it as it was', () => {
    const device = new DataSession(snapshot(base));
    device.edit(lifted);
    const answer = applyCommand(device.prepare('mine-1', 'owner')!, snapshot(nested, 2));
    device.accept(answer);
    device.release('mine-1');
    device.acceptRemote();
    expect(planOf(device.getState().draft)).toEqual(planOf(nested));
    expect(device.getState().dirty).toBe(false);
  });

  it('keeps on "keep mine" a point the other device added meanwhile, with its words', () => {
    const theirs = sermon([node('P', [node('Y', [node('X')])]), { id: 'Z', title: 'precious remote words' }]);
    const result = mergeDocumentFields(base, lifted, theirs);
    expect(result.conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan']]);
    const plan = planOf(result.value.value as DocumentData);
    expect(plan).toEqual(expect.arrayContaining([node('P', [node('Y')]), node('X'), { id: 'Z', title: 'precious remote words' }]));
    expect(pointIds(plan).sort()).toEqual(['P', 'X', 'Y', 'Z']);
  });

  it('puts the point where this device put it, with the words the other device gave it', () => {
    const renamedThere = sermon([node('P', [node('Y', [{ id: 'X', title: 'X with new words' }])])]);
    const result = mergeDocumentFields(base, lifted, renamedThere);
    expect(planOf(result.value.value as DocumentData)).toEqual([node('P', [node('Y')]), { id: 'X', title: 'X with new words' }]);
  });
});

describe('copies of a moved point that differ below it (Codex refute-twins r2)', () => {
  // Every id with every title it carries anywhere in the plan (a twin carries two).
  const titles = (doc: DocumentData) => {
    const found: Record<string, string[]> = {};
    const walk = (nodes: Json[]) => nodes.forEach(item => {
      const entry = item as DocumentData;
      (found[String(entry.id)] ??= []).push(String(entry.title));
      walk((entry.children ?? []) as Json[]);
    });
    walk(planOf(doc));
    return found;
  };
  const cases: [string, DocumentData, DocumentData, DocumentData][] = [
    ['a point and its parent moved into each other', sermon([node('D', [node('B')]), node('C')]),
      sermon([node('C', [node('D', [node('B')])])]),
      sermon([node('B', [node('D'), { id: 'R', title: 'precious remote words' }]), node('C')])],
    ['a point and its sub-point moved to different places', sermon([node('P', [node('X', [node('C')])]), node('A'), node('B'), node('D')]),
      sermon([node('P'), node('A', [node('X', [node('C')])]), node('B'), node('D')]),
      sermon([node('P'), node('A'), node('B', [node('X')]), node('D', [{ id: 'C', title: 'remote C' }]), node('R')])],
    ['a sub-point lifted here and given words there', sermon([node('P', [node('X', [node('C')])]), node('A'), node('B')]),
      sermon([node('P'), node('A', [node('X')]), node('B'), node('C')]),
      sermon([node('P'), node('A'), node('B', [node('X', [{ id: 'C', title: 'remote C' }, node('R')])])])],
  ];

  // Every point with every parent it sits under anywhere in the plan.
  const homes = (doc: DocumentData) => {
    const found: string[] = [];
    const walk = (nodes: Json[], parent: string) => nodes.forEach(item => {
      const entry = item as DocumentData;
      found.push(`${entry.id} under ${parent}`);
      walk((entry.children ?? []) as Json[], String(entry.id));
    });
    walk(planOf(doc), 'top');
    return found;
  };

  it.each(cases)('loses no point, no words and none of this device\'s places: %s', (_name, start, mine, theirs) => {
    const merged = mergeDocumentFields(start, mine, theirs).value.value as DocumentData;
    expect(homes(merged)).toEqual(expect.arrayContaining(homes(mine)));
    const kept = titles(merged);
    for (const side of [mine, theirs]) {
      for (const id of Object.keys(titles(side))) expect(kept).toHaveProperty(id);
    }
    for (const words of Object.values(titles(theirs)).flat().filter(title => title.includes('remote'))) {
      expect(Object.values(kept).flat()).toContain(words);
    }
  });

  it('settles a moved point with its sub-points once, where this device put it', () => {
    const start = sermon([node('P', [node('X', [node('C1'), node('C2')])]), node('A'), node('B')]);
    const mine = sermon([node('P'), node('A', [node('X', [node('C1'), node('C2')])]), node('B')]);
    const theirs = sermon([node('P'), node('A'), node('B', [node('X', [node('C1'), node('C2')])]), node('Z')]);
    const result = mergeDocumentFields(start, mine, theirs);
    expect(result.conflicts.map(conflict => conflict.path)).toEqual([['preparation', 'exegeticalPlan']]);
    const plan = planOf(result.value.value as DocumentData);
    expect(plan).toEqual(expect.arrayContaining([node('A', [node('X', [node('C1'), node('C2')])]), node('B'), node('Z')]));
    expect(pointIds(plan).sort()).toEqual(['A', 'B', 'C1', 'C2', 'P', 'X', 'Z']);
  });

  it('settles a large moved branch in one pass', () => {
    const many = Array.from({ length: 3000 }, (_, index) => node(`C${index}`));
    const start = sermon([node('P', [node('X', many)]), node('A'), node('B')]);
    const mine = sermon([node('P'), node('A', [node('X', many)]), node('B')]);
    const theirs = sermon([node('P'), node('A'), node('B', [node('X', many)])]);
    const ids = pointIds(planOf(mergeDocumentFields(start, mine, theirs).value.value as DocumentData));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3004);
  });
});

describe('twins already in the exegetical plan block nothing', () => {
  const twinParent = sermon([node('P'), node('A', [node('P')])]);

  it('saves an ordinary action on a point that is already twinned', () => {
    // The plan helpers address a point by id, so a child added to P lands under both copies of P.
    const withChild = sermon([node('P', [node('NEW')]), node('A', [node('P', [node('NEW')])])]);
    expect(applyCommand(update(twinParent, withChild), snapshot(twinParent)).kind).toBe('acknowledged');
  });

  it('saves a plan that keeps fewer copies of an old twin', () => {
    const three = sermon([node('A', [node('X')]), node('B', [node('X')]), node('X')]);
    const two = sermon([node('A'), node('B', [node('X')]), node('X')]);
    expect(applyCommand(update(three, two), snapshot(three)).kind).toBe('acknowledged');
  });

  it('saves "keep mine" after the other device removed one copy of an old twin', () => {
    const stored = sermon([node('P', [node('X')]), node('X')]);
    const edited = sermon([node('P', [{ id: 'X', title: 'precious words' }]), { id: 'X', title: 'precious words' }]);
    const repaired = sermon([node('P', []), node('X')]);
    const device = new DataSession(snapshot(stored));
    device.edit(edited);
    const answer = applyCommand(device.prepare('mine-1', 'owner')!, snapshot(repaired, 2));
    expect(answer.kind).toBe('conflict');
    device.accept(answer);
    device.release('mine-1');
    device.keepLocal();
    expect(applyCommand(device.prepare('mine-2', 'owner')!, snapshot(repaired, 2)).kind).toBe('acknowledged');
  });

  it('lets an edit through a plan that already held a twin', () => {
    const old = sermon([node('P', [node('X')]), node('X')]);
    expect(applyCommand(update(old, { ...old, title: 'Renamed' }), snapshot(old)).kind).toBe('acknowledged');
    const edited = sermon([node('P', [node('X')]), node('X'), node('N')]);
    expect(applyCommand(update(old, edited), snapshot(old)).kind).toBe('acknowledged');
  });

  it('merges quietly when both sides already held the twin and changed other points', () => {
    const old = sermon([node('P', [node('X'), node('A')]), node('X')]);
    const mine = sermon([node('P', [node('X'), { id: 'A', title: 'A renamed' }]), node('X')]);
    const theirs = sermon([node('P', [node('X'), node('A')]), node('X'), node('B')]);
    const result = mergeDocumentFields(old, mine, theirs);
    expect(result.conflicts).toEqual([]);
    expect(pointIds(planOf(result.value.value as DocumentData))).toEqual(['P', 'X', 'A', 'X', 'B']);
  });
});

describe('what is not a point of the exegetical plan', () => {
  it('counts only points: ids in a point\'s own lists are not points', () => {
    const start = sermon([node('A'), node('B')]);
    const mine = sermon([node('A', undefined, { attachments: [{ id: 'Q' }] }), node('B')]);
    const theirs = sermon([node('A'), node('B', undefined, { attachments: [{ id: 'Q' }] })]);
    expect(mergeDocumentFields(start, mine, theirs).conflicts).toEqual([]);
    expect(applyCommand(update(start, mine), snapshot(theirs)).kind).toBe('acknowledged');
  });

  it('merges quietly when the two devices change different points', () => {
    const renamed = sermon([node('P', [node('Y'), { id: 'X', title: 'X renamed' }])]);
    const added = sermon([node('P', [node('Y'), node('X')]), node('Z')]);
    const result = mergeDocumentFields(base, renamed, added);
    expect(result.conflicts).toEqual([]);
    expect(pointIds(planOf(result.value.value as DocumentData))).toEqual(['P', 'Y', 'X', 'Z']);
  });

  it('does not treat ids of other lists of the sermon as points of the plan', () => {
    const start = sermon([node('X')]);
    const result = mergeDocumentFields(start, { ...start, thoughts: [{ id: 'X', text: 'x' }] },
      sermon([node('X')], { scratch: [{ id: 'X', text: 'x', createdAt: '2026-10-11' }] }));
    expect(result.conflicts).toEqual([]);
  });
});
