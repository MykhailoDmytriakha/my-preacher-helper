import { applyCommand, validateCommand } from '../protocol';
import { DataSession } from '../session';
import type { ResourceSnapshot } from '../types';
const snap = (content = 'base', revision = 1): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id: 'one' }, value: { content }, metadata: { protocol: 1, generation: 'g1', revision, deleted: false } });

describe('DataSession', () => {
  it('rebases only post-submit edits over server metadata and independently merged siblings', () => {
    const base = { ...snap(), value: { userId: 'owner', title: 'A', content: 'B', tags: ['old'], rev: { note: 1 } } };
    const session = new DataSession(base);
    session.edit({ ...base.value, title: 'X' });
    const first = session.prepare('first', 'owner')!;
    session.edit({ ...session.getState().draft!, content: 'Y' });
    const remote = { ...base, value: { ...base.value, tags: ['remote'], rev: { note: 2 } }, metadata: { ...base.metadata!, revision: 2 } };
    const acknowledgement = applyCommand(first, remote);
    expect(acknowledgement.kind).toBe('acknowledged');
    session.accept(acknowledgement);
    expect(session.getState().draft).toEqual({ userId: 'owner', title: 'X', content: 'Y', tags: ['remote'], rev: { note: 3 } });
    const next = session.prepare('second', 'owner')!;
    expect(next).toMatchObject({ kind: 'update', changes: [{ path: ['content'], before: { exists: true, value: 'B' }, after: { exists: true, value: 'Y' } }] });
    expect(() => validateCommand(next)).not.toThrow();
  });
  it('retains conflicts in post-submit typing and blocks implicit overwrite after recovery', () => {
    const session = new DataSession(snap());
    session.edit({ content: 'A' }); session.prepare('first', 'owner');
    session.edit({ content: 'B' });
    session.accept({ kind: 'acknowledged', operationId: 'first', snapshot: snap('remote', 2) });
    expect(session.getState()).toMatchObject({ draft: { content: 'B' }, pending: {}, conflicts: [{ path: ['content'] }], remoteCandidate: snap('remote', 2) });
    const restored = DataSession.restore(session.checkpoint());
    expect(restored.prepare('second', 'owner')).toBeNull();
    restored.acceptRemote();
    expect(restored.getState()).toMatchObject({ draft: { content: 'remote' }, conflicts: [], dirty: false });
  });
  it('retains a newer observed snapshot when an older own ACK arrives', () => {
    const session = new DataSession(snap());
    session.edit({ content: 'A' }); session.prepare('first', 'owner');
    session.observe(snap('newer remote', 4), { source: 'server' });
    session.accept({ kind: 'acknowledged', operationId: 'first', snapshot: snap('A', 2) });
    expect(session.getState()).toMatchObject({ confirmed: snap('newer remote', 4), draft: { content: 'newer remote' }, pending: {}, dirty: false });
    session.observe(snap('A', 2), { source: 'server' });
    expect(session.getState().confirmed).toEqual(snap('newer remote', 4));
  });
  it('preserves a user reversal while its previous write is still in flight', () => {
    const session = new DataSession(snap());
    session.edit({ content: 'A' }); session.prepare('first', 'owner');
    session.edit({ content: 'base' });
    session.observe(snap('newer', 4), { source: 'server' });
    session.accept({ kind: 'acknowledged', operationId: 'first', snapshot: snap('A', 2) });
    expect(session.getState()).toMatchObject({ confirmed: snap('newer', 4), draft: { content: 'base' }, pending: {}, conflicts: [{ path: ['content'] }] });
  });
  it('rejects reserved field changes before preparing any pending command', () => {
    const initial = { ...snap(), value: { content: 'base', rev: { note: 1 } } };
    const session = new DataSession(initial);
    session.edit({ content: 'mine', rev: { note: 0 } });
    expect(() => session.prepare('bad', 'owner')).toThrow('Invalid field change');
    expect(session.getState().pending).toEqual({});
  });
  it('keeps newer deletion intent and finalizes its accepted tombstone', () => {
    const session = new DataSession(snap());
    session.edit({ content: 'A' }); session.prepare('first', 'owner');
    session.edit(null);
    session.accept({ kind: 'acknowledged', operationId: 'first', snapshot: snap('A', 2) });
    expect(session.getState()).toMatchObject({ draft: null, dirty: true });
    const command = session.prepare('delete', 'owner');
    expect(command?.kind).toBe('delete');
    const deleted = { ...snap(), value: null, metadata: { ...snap().metadata!, deleted: true, revision: 3 } };
    session.accept({ kind: 'acknowledged', operationId: 'delete', snapshot: deleted });
    expect(session.getState()).toMatchObject({ draft: null, dirty: false, confirmed: deleted });
  });

  it('retains newer typing after an old ACK across checkpoint recovery', () => {
    const session = new DataSession(snap());
    expect(session.prepare('empty', 'owner')).toBeNull();
    session.edit({ content: 'A' });
    expect(session.prepare('first', 'owner')).toMatchObject({ kind: 'update', changes: [{ path: ['content'], before: { exists: true, value: 'base' }, after: { exists: true, value: 'A' } }] });
    expect(() => session.prepare('first', 'owner')).toThrow('already prepared');
    session.edit({ content: 'B' });
    expect(session.prepare('second', 'owner')).toBeNull();
    const recovered = DataSession.restore(session.checkpoint());
    recovered.accept({ kind: 'acknowledged', operationId: 'first', snapshot: snap('A', 2) });
    expect(recovered.getState()).toMatchObject({ confirmed: { value: { content: 'A' } }, draft: { content: 'B' }, dirty: true, pending: {} });
    expect(recovered.prepare('second', 'owner')).toMatchObject({ changes: [{ before: { value: 'A' }, after: { value: 'B' } }] });
    recovered.accept({ kind: 'acknowledged', operationId: 'second', snapshot: snap('B', 3) });
    expect(recovered.getState().dirty).toBe(false);
    recovered.observe(snap('A', 2), { source: 'server' });
    expect(recovered.getState().draft).toEqual({ content: 'B' });
  });
  it('keeps deleted remote separate from local work and ignores cache absence', () => {
    const session = new DataSession(snap());
    session.observe({ ...snap(), value: null, metadata: null }, { source: 'cache' });
    session.edit({ content: 'mine' });
    const deleted = { ...snap(), value: null, metadata: { ...snap().metadata!, deleted: true, revision: 2 } };
    session.observe(deleted, { source: 'server' });
    expect(session.getState()).toMatchObject({ draft: { content: 'mine' }, dirty: true, remoteCandidate: deleted });
    session.acceptRemote();
    expect(session.getState()).toMatchObject({ confirmed: deleted, draft: null, dirty: false, remoteCandidate: null });
    session.acceptRemote();
  });
  it('keeps the newest candidate and ignores unrelated or older generations', () => {
    const session = new DataSession(snap());
    session.observe(snap(), { source: 'server' });
    session.observe({ ...snap('wrong'), resource: { collection: 'studyNotes', id: 'other' } }, { source: 'server' });
    session.observe({ ...snap('wrong'), metadata: null }, { source: 'server' });
    session.observe({ ...snap('wrong'), metadata: { ...snap().metadata!, generation: 'old' } }, { source: 'server' });
    expect(session.getState().draft).toEqual({ content: 'base' });
    session.observe(snap('clean remote', 2), { source: 'server' });
    expect(session.getState().draft).toEqual({ content: 'clean remote' });
    session.edit({ content: 'mine' });
    session.observe(snap('newest', 4), { source: 'server' });
    session.observe(snap('older', 3), { source: 'server' });
    expect(session.getState().remoteCandidate?.value).toEqual({ content: 'newest' });
  });
  it('creates and deletes explicitly, retaining refused work', () => {
    const session = new DataSession({ ...snap(), value: null, metadata: null });
    session.observe({ ...snap(), value: null, metadata: null }, { source: 'cache' });
    session.edit({ content: 'new' });
    expect(session.prepare('create', 'owner')).toMatchObject({ kind: 'create', generation: null, value: { content: 'new' } });
    session.accept({ kind: 'refused', operationId: 'create', code: 'forbidden' });
    expect(session.getState().dirty).toBe(true);
    session.release('create');
    session.accept({ kind: 'acknowledged', operationId: 'missing', snapshot: snap('ignored', 4) });
    session.observe(snap('new', 1), { source: 'server' });
    session.acceptRemote();
    session.edit(null);
    expect(session.prepare('delete', 'owner')).toMatchObject({ kind: 'delete', baseline: { content: 'new' } });
    session.accept({ kind: 'deleted', operationId: 'delete', snapshot: { ...snap(), value: null, metadata: { ...snap().metadata!, deleted: true, revision: 2 } } });
    expect(session.getState().remoteCandidate?.value).toBeNull();
  });
  it('prevents an old ACK from regressing a user accepted remote copy', () => {
    const session = new DataSession(snap());
    session.edit({ content: 'A' });
    session.prepare('first', 'owner');
    session.observe(snap('remote', 4), { source: 'server' });
    expect(() => session.acceptRemote()).toThrow('Resolve pending');
    session.release('first');
    session.acceptRemote();
    session.accept({ kind: 'acknowledged', operationId: 'first', snapshot: snap('A', 2) });
    expect(session.getState().draft).toEqual({ content: 'remote' });
    const checkpoint = session.checkpoint();
    checkpoint.draft!.content = 'mutated';
    expect(session.getState().draft).toEqual({ content: 'remote' });
  });
});

describe('DataSession explicit local conflict resolution', () => {
  it('chooses the local conflicting field while preserving another device sibling', () => {
    const base = { ...snap(), value: { content: 'base', tags: ['old'] } };
    const session = new DataSession(base);
    session.edit({ content: 'mine', tags: ['old'] });
    const remote = { ...snap('theirs', 2), value: { content: 'theirs', tags: ['remote'] } };
    session.observe(remote, { source: 'server' });
    const generation = session.getState().editGeneration;
    session.keepLocal();
    expect(session.getState()).toMatchObject({ confirmed: remote, draft: { content: 'mine', tags: ['remote'] }, dirty: true, conflicts: [], remoteCandidate: null, editGeneration: generation + 1 });
    expect(session.prepare('resolved', 'owner')).toMatchObject({ changes: [{ path: ['content'], before: { exists: true, value: 'theirs' }, after: { exists: true, value: 'mine' } }] });
  });

  it('requires settled pending identities and preserves deleted drafts for a new copy', () => {
    const session = new DataSession(snap()); session.edit({ content: 'mine' }); session.prepare('pending', 'owner');
    expect(() => session.keepLocal()).toThrow('Resolve pending');
    session.release('pending');
    session.observe({ ...snap(), value: null, metadata: { ...snap().metadata!, revision: 2, deleted: true } }, { source: 'server' });
    const before = session.checkpoint();
    expect(() => session.keepLocal()).toThrow('use a new copy');
    expect(session.checkpoint()).toEqual(before);
    const deleted = new DataSession({ ...snap(), value: null, metadata: { ...snap().metadata!, deleted: true } });
    deleted.edit({ content: 'recovered' });
    expect(() => deleted.keepLocal()).toThrow('use a new copy');
  });

  it('preserves a corrected draft without a candidate and supports explicit deletion intent', () => {
    const session = new DataSession(snap()); session.edit({ content: 'corrected' }); session.keepLocal();
    expect(session.getState()).toMatchObject({ confirmed: snap(), draft: { content: 'corrected' }, dirty: true });
    session.edit(null); session.observe(snap('remote', 2), { source: 'server' }); session.keepLocal();
    expect(session.getState()).toMatchObject({ confirmed: snap('remote', 2), draft: null, dirty: true, conflicts: [] });
    const newCopy = new DataSession({ ...snap(), value: null, metadata: null });
    newCopy.edit({ content: 'new' }); newCopy.observe(snap('existing'), { source: 'server' }); newCopy.keepLocal();
    expect(newCopy.getState()).toMatchObject({ confirmed: snap('existing'), draft: { content: 'new' }, dirty: true });
  });
});
