import { applyCommand, mergeDocumentFields } from '../protocol';
import { DataSession } from '../session';

import type { DataCommand, DocumentData, Json, ResourceSnapshot } from '../types';

const resource = { collection: 'sermons', id: 'plan-tree-identity' };
const owner = 'plan-tree-owner';
const generation = 'plan-tree-generation';
const metadata = (revision: number) => ({ protocol: 1 as const, generation, revision, deleted: false });
const snapshot = (value: DocumentData, revision = 1): ResourceSnapshot => ({ resource, value, metadata: metadata(revision) });
const node = (id: string, title = id, children?: Json[]): DocumentData => ({
  id, title, ...(children ? { children } : {}),
});
const sermon = (plan: Json[], other: DocumentData = {}): DocumentData => ({
  userId: owner,
  title: 'Identity merge fixture',
  preparation: { exegeticalPlan: plan, authorIntent: 'Keep the rest of the preparation.' },
  ...other,
});
const planOf = (value: DocumentData | null | undefined): Json[] =>
  ((value?.preparation as DocumentData | undefined)?.exegeticalPlan ?? []) as Json[];
const nodesById = (plan: Json[]): Map<string, DocumentData[]> => {
  const found = new Map<string, DocumentData[]>();
  const visit = (rows: Json[]) => rows.forEach(raw => {
    const point = raw as DocumentData;
    const copies = found.get(String(point.id)) ?? [];
    copies.push(point);
    found.set(String(point.id), copies);
    visit(Array.isArray(point.children) ? point.children as Json[] : []);
  });
  visit(plan);
  return found;
};
const parentById = (plan: Json[]): Map<string, string | null> => {
  const found = new Map<string, string | null>();
  const visit = (rows: Json[], parent: string | null) => rows.forEach(raw => {
    const point = raw as DocumentData;
    found.set(String(point.id), parent);
    visit(Array.isArray(point.children) ? point.children as Json[] : [], String(point.id));
  });
  visit(plan, null);
  return found;
};
const aggregatePreparationUpdate = (base: DocumentData, next: DocumentData, operationId: string): DataCommand => ({
  protocol: 1,
  operationId,
  owner,
  resource,
  generation,
  dependsOn: [],
  kind: 'update',
  changes: [{
    path: ['preparation'],
    before: { exists: true, value: base.preparation as Json },
    after: { exists: true, value: next.preparation as Json },
  }],
});
describe('exegetical plan identity merge through public engine surfaces', () => {
  it('merges an aggregate preparation update with an independent remote point title', () => {
    const base = sermon([node('Parent', 'Parent', [node('Anchor'), node('Moving', 'Opening words')])]);
    const local = sermon([node('Parent', 'Parent', [node('Anchor')]), node('Moving', 'Opening words')]);
    const remote = sermon([node('Parent', 'Parent', [node('Anchor'), node('Moving', 'Words saved remotely')])]);

    const result = applyCommand(aggregatePreparationUpdate(base, local, 'aggregate-outdent'), snapshot(remote, 2));

    expect(result.kind).toBe('acknowledged');
    if (result.kind !== 'acknowledged') return;
    expect(parentById(planOf(result.snapshot.value)).get('Moving')).toBeNull();
    expect(nodesById(planOf(result.snapshot.value)).get('Moving')).toHaveLength(1);
    expect(nodesById(planOf(result.snapshot.value)).get('Moving')?.[0].title).toBe('Words saved remotely');
  });

  it('reports competing branch homes while its candidate keeps the local home and remote descendant words', () => {
    const base = sermon([node('Parent', 'Parent', [node('Anchor'), node('Moving', 'Moving', [node('Child', 'Original child words')])])]);
    const local = sermon([node('Parent', 'Parent', [node('Anchor')]), node('Moving', 'Moving', [node('Child', 'Original child words')])]);
    const remote = sermon([node('Parent', 'Parent', [node('Anchor', 'Anchor', [node('Moving', 'Moving', [node('Child', 'Remote child words')])])])]);

    const candidate = mergeDocumentFields(base, local, remote);
    const applied = applyCommand(aggregatePreparationUpdate(base, local, 'competing-branch-homes'), snapshot(remote, 2));

    expect(candidate.conflicts.map(conflict => conflict.path)).toContainEqual(['preparation', 'exegeticalPlan']);
    expect(parentById(planOf(candidate.value.value as DocumentData)).get('Moving')).toBeNull();
    expect(nodesById(planOf(candidate.value.value as DocumentData)).get('Moving')).toHaveLength(1);
    expect(nodesById(planOf(candidate.value.value as DocumentData)).get('Child')?.[0].title).toBe('Remote child words');
    expect(applied).toMatchObject({ kind: 'conflict', snapshot: { value: remote } });
  });

  it('keeps remote words and avoids twins after the session explicitly keeps local placement and retries', () => {
    const base = sermon([node('Parent', 'Parent', [node('Anchor'), node('Moving', 'Moving', [node('Child', 'Original child words')])])]);
    const local = sermon([node('Parent', 'Parent', [node('Anchor')]), node('Moving', 'Moving', [node('Child', 'Original child words')])]);
    const remote = sermon([node('Parent', 'Parent', [node('Anchor', 'Anchor', [node('Moving', 'Moving', [node('Child', 'Remote child words')])])])]);
    const server = snapshot(remote, 2);
    const session = new DataSession(snapshot(base));
    session.edit(local);
    const first = session.prepare('session-first-update', owner)!;
    const rejected = applyCommand(first, server);

    expect(rejected.kind).toBe('conflict');
    session.accept(rejected);
    session.release(first.operationId);
    session.keepLocal();
    const retry = session.prepare('session-keep-local-retry', owner)!;
    const accepted = applyCommand(retry, server);

    expect(accepted.kind).toBe('acknowledged');
    if (accepted.kind !== 'acknowledged') return;
    session.accept(accepted);
    const savedPlan = planOf(accepted.snapshot.value);
    expect(parentById(savedPlan).get('Moving')).toBeNull();
    expect(nodesById(savedPlan).get('Moving')).toHaveLength(1);
    expect(nodesById(savedPlan).get('Child')).toHaveLength(1);
    expect(nodesById(savedPlan).get('Child')?.[0].title).toBe('Remote child words');
    expect(session.getState()).toMatchObject({ dirty: false, conflicts: [] });
  });

  it('combines a local ancestor move with an independent remote descendant move', () => {
    const base = sermon([node('Parent', 'Parent', [node('Moving', 'Moving', [node('Child')])]), node('Left'), node('Right')]);
    const local = sermon([node('Left', 'Left', [node('Parent', 'Parent', [node('Moving', 'Moving', [node('Child')])])]), node('Right')]);
    const remote = sermon([node('Parent', 'Parent', [node('Moving')]), node('Left'), node('Right', 'Right', [node('Child')])]);

    const result = mergeDocumentFields(base, local, remote);
    const plan = planOf(result.value.value as DocumentData);
    const parents = parentById(plan);

    expect(result.conflicts).toEqual([]);
    expect(parents.get('Parent')).toBe('Left');
    expect(parents.get('Moving')).toBe('Parent');
    expect(parents.get('Child')).toBe('Right');
    expect(nodesById(plan).get('Child')).toHaveLength(1);
  });

  it('retains a remote-only sibling when local outdents another point', () => {
    const base = sermon([node('Parent', 'Parent', [node('Anchor'), node('Moving')])]);
    const local = sermon([node('Parent', 'Parent', [node('Anchor')]), node('Moving')]);
    const remote = sermon([node('Parent', 'Parent', [node('Anchor'), node('Moving')]), node('Remote sibling', 'Remote sibling words')]);

    const result = mergeDocumentFields(base, local, remote);
    const plan = planOf(result.value.value as DocumentData);

    expect(result.conflicts).toEqual([]);
    expect(parentById(plan).get('Moving')).toBeNull();
    expect(nodesById(plan).get('Remote sibling')?.[0].title).toBe('Remote sibling words');
  });

  it('turns a would-be cycle between independently moved ancestors into a conflict', () => {
    const base = sermon([node('A', 'A', [node('B')]), node('C')]);
    const local = sermon([node('B', 'B', [node('A')]), node('C')]);
    const remote = sermon([node('A'), node('C', 'C', [node('B')])]);

    const result = mergeDocumentFields(base, local, remote);
    const plan = planOf(result.value.value as DocumentData);

    expect(result.conflicts.length).toBeGreaterThan(0);
    for (const copies of nodesById(plan).values()) expect(copies.length).toBeLessThanOrEqual(1);
  });

  it('keeps local parent deletion as the candidate and retains a remote child edit as a conflict', () => {
    const base = sermon([node('Parent', 'Parent', [node('Child', 'Original child words')])]);
    const local = sermon([]);
    const remote = sermon([node('Parent', 'Parent', [node('Child', 'Remote child words')])]);

    const result = mergeDocumentFields(base, local, remote);
    const planConflict = result.conflicts.find(conflict => conflict.path[0] === 'preparation' && conflict.path[1] === 'exegeticalPlan');

    expect(planConflict).toBeDefined();
    expect(planOf(result.value.value as DocumentData)).toEqual([]);
    expect(JSON.stringify(planConflict?.theirs)).toContain('Remote child words');
  });

  it('keeps a locally moved-out descendant when the remote copy deleted its former parent', () => {
    const base = sermon([node('Parent', 'Parent', [node('Branch', 'Branch', [node('Moved child', 'Child words')])])]);
    const local = sermon([node('Moved child', 'Child words')]);
    const remote = sermon([]);

    const result = mergeDocumentFields(base, local, remote);
    const plan = planOf(result.value.value as DocumentData);

    expect(nodesById(plan).get('Moved child')?.[0].title).toBe('Child words');
    expect(nodesById(plan).get('Moved child')).toHaveLength(1);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('keeps an explicit local parent deletion and records a remote moved-out alternative as conflict', () => {
    const base = sermon([node('Parent', 'Parent', [node('Branch', 'Branch', [node('Moved child', 'Child words')])])]);
    const local = sermon([]);
    const remote = sermon([node('Moved child', 'Child words')]);

    const result = mergeDocumentFields(base, local, remote);
    const plan = planOf(result.value.value as DocumentData);
    const remoteAlternative = JSON.stringify(result.conflicts.map(conflict => conflict.theirs));

    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(plan).toEqual([]);
    expect(remoteAlternative).toContain('Moved child');
  });

  it('does not orphan a point moved under a locally deleted destination and retains its remote words', () => {
    const outcomes = ['N0', 'Remote N0 words'].map(remoteTitle => {
      const base = sermon([node('N0'), node('N1', 'N1', [node('N5')])]);
      const local = sermon([node('N0'), node('N1')]);
      const theirs = sermon([node('N1', 'N1', [node('N5', 'N5', [node('N0', remoteTitle)])])]);
      const result = mergeDocumentFields(base, local, theirs);
      const candidate = planOf(result.value.value as DocumentData);
      const byId = nodesById(candidate);
      return {
        conflictPaths: result.conflicts.map(conflict => conflict.path),
        ids: [...byId.keys()].sort(),
        n0Count: byId.get('N0')?.length ?? 0,
        n0Parent: parentById(candidate).get('N0') ?? null,
        n0Title: byId.get('N0')?.[0].title ?? null,
        n5Present: byId.has('N5'),
      };
    });

    expect(outcomes).toEqual([
      { conflictPaths: [['preparation', 'exegeticalPlan']], ids: ['N0', 'N1'], n0Count: 1, n0Parent: null, n0Title: 'N0', n5Present: false },
      { conflictPaths: [['preparation', 'exegeticalPlan']], ids: ['N0', 'N1'], n0Count: 1, n0Parent: null, n0Title: 'Remote N0 words', n5Present: false },
    ]);
  });

  it('preserves the point through a real KeepLocal retry after the remote move under a locally deleted destination', () => {
    const base = sermon([node('N0'), node('N1', 'N1', [node('N5')])]);
    const local = sermon([node('N0'), node('N1')]);
    const theirs = sermon([node('N1', 'N1', [node('N5', 'N5', [node('N0', 'Remote N0 words')])])]);
    const server = snapshot(theirs, 2);
    const session = new DataSession(snapshot(base));
    session.edit(local);
    const first = session.prepare('orphan-first-update', owner)!;
    const rejected = applyCommand(first, server);

    expect(rejected.kind).toBe('conflict');
    session.accept(rejected);
    session.release(first.operationId);
    session.keepLocal();
    const retry = session.prepare('orphan-keep-local-retry', owner)!;
    const accepted = applyCommand(retry, server);

    expect(accepted.kind).toBe('acknowledged');
    if (accepted.kind !== 'acknowledged') return;
    session.accept(accepted);
    const ids = nodesById(planOf(accepted.snapshot.value));
    expect([...ids.keys()].sort()).toEqual(['N0', 'N1']);
    expect(ids.get('N0')).toHaveLength(1);
    expect(parentById(planOf(accepted.snapshot.value)).get('N0')).toBeNull();
    expect(ids.get('N0')?.[0].title).toBe('Remote N0 words');
    expect(session.getState()).toMatchObject({ dirty: false, conflicts: [] });
  });

  it('preserves local ancestry for a point whose remote home and ancestor were both removed', () => {
    const base = sermon([node('Parent', 'Parent', [node('N0')]), node('N5')]);
    const local = sermon([node('Parent', 'Parent', [node('N0')])]);
    const theirs = sermon([node('N5', 'N5', [node('N0', 'Remote N0 words')])]);

    const result = mergeDocumentFields(base, local, theirs);
    const candidate = planOf(result.value.value as DocumentData);
    const byId = nodesById(candidate);

    expect(result.conflicts.map(conflict => conflict.path)).toContainEqual(['preparation', 'exegeticalPlan']);
    expect(byId.get('N0')).toHaveLength(1);
    expect(parentById(candidate).get('N0')).toBe('Parent');
    expect(byId.has('N5')).toBe(false);
    expect([...byId.keys()].sort()).toEqual(['N0', 'Parent']);
  });

  it('does not treat an omitted child list and an empty child list as competing deletion', () => {
    const base = sermon([node('Point', 'Original words')]);
    const local = sermon([node('Point', 'Local words')]);
    const remote = sermon([node('Point', 'Original words', [])]);

    const result = mergeDocumentFields(base, local, remote);

    expect(result.conflicts).toEqual([]);
    expect(nodesById(planOf(result.value.value as DocumentData)).get('Point')?.[0].title).toBe('Local words');
  });

  it('quietly accepts local deletion when the remote copy only materialized an empty children list', () => {
    const base = sermon([node('Parent', 'Parent', [node('Moving')])]);
    const local = sermon([node('Parent')]);
    const remote = sermon([node('Parent', 'Parent', [node('Moving', 'Moving', [])])]);

    const result = mergeDocumentFields(base, local, remote);

    expect(result.conflicts).toEqual([]);
    expect(nodesById(planOf(result.value.value as DocumentData)).has('Moving')).toBe(false);
  });

  it('keeps a true competing edit to the same point title as a conflict', () => {
    const base = sermon([node('Point', 'Original words')]);
    const local = sermon([node('Point', 'Local words')]);
    const remote = sermon([node('Point', 'Remote words')]);

    const result = mergeDocumentFields(base, local, remote);

    expect(result.conflicts.map(conflict => conflict.path)).toContainEqual(['preparation', 'exegeticalPlan', 'id:Point', 'title']);
    expect(nodesById(planOf(result.value.value as DocumentData)).get('Point')?.[0].title).toBe('Local words');
  });
});
