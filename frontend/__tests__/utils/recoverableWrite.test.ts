import {
  announceIfPersisted,
  awaitAcceptance,
  refusedWrite,
  persistedWrite,
  queuedWrite,
  replicaAcceptedWrite,
  skippedWrite,
} from '@/utils/recoverableWrite';

// A refusal must look exactly like the SDK's: production classifies by `error.code`
// alone, so a hand-made Error without it would exercise the transient branch and
// prove nothing about the path that actually runs.
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), {
  code: 'permission-denied',
  name: 'FirebaseError',
});

// Recognised by the `isOfflineQueued` marker alone (conflictSafeUpdate.client.ts:89),
// so the shape here is the real contract rather than an import of the Firebase module.
const offlineQueued = () => Object.assign(new Error('queued while offline'), {
  isOfflineQueued: true,
  aggregate: 'core',
  name: 'OfflineQueuedError',
});

describe('recoverableWrite — the three outcomes are distinguishable', () => {
  it('a persisted write reports persistence, and only that may be announced', async () => {
    const submission = persistedWrite(Promise.resolve({ id: 'x' }));

    const acceptance = await awaitAcceptance(submission, () => {
      throw new Error('a successful write must not reach the late-failure path');
    });

    expect(acceptance).toEqual({ kind: 'persisted' });
    const announce = jest.fn();
    announceIfPersisted(acceptance, announce);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('a queued write is accepted but stays SILENT — the offline mirror', async () => {
    let settle: () => void = () => undefined;
    const persistence = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const submission = queuedWrite('outbox:1', persistence);

    const acceptance = await awaitAcceptance(submission, () => undefined);

    expect(acceptance).toEqual({ kind: 'queued', receipt: 'outbox:1' });
    const announce = jest.fn();
    announceIfPersisted(acceptance, announce);
    // THE POINT OF THE TYPE: a queued write cannot be announced as saved, because
    // there is no branch that would let it through.
    expect(announce).not.toHaveBeenCalled();
    settle();
  });

  it('a skipped write announces nothing — an in-flight duplicate is not a save', async () => {
    const acceptance = await awaitAcceptance(skippedWrite(), () => undefined);

    expect(acceptance).toEqual({ kind: 'skipped', reason: 'in-flight' });
    const announce = jest.fn();
    announceIfPersisted(acceptance, announce);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('recoverableWrite — refusals reach the right side', () => {
  it('a LOCAL refusal announces itself, because nothing else can', async () => {
    /**
     * The silence this closes: `refusedWrite` never becomes a mutation, so no recovery
     * descriptor will ever see it — and editors are silent by rule. Without a sentence
     * of its own, the person pressed Save, nothing happened, and nothing explained why.
     */
    const { toast } = jest.requireMock('sonner') as { toast: { error: jest.Mock } };
    toast.error.mockClear();

    const submission = refusedWrite('not-found', 'The document is gone', 'Save refused.');

    await expect(awaitAcceptance(submission, () => undefined)).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe('Save refused.');
  });

  it('says it exactly once, so no editor needs to repeat it', async () => {
    // The sentence is REQUIRED by the signature: an optional one produced the silence
    // this whole mechanism exists to prevent, and two speakers produced the duplicate.
    const { toast } = jest.requireMock('sonner') as { toast: { error: jest.Mock } };
    toast.error.mockClear();

    const submission = refusedWrite('unauthenticated', 'No signed-in user', 'Save refused.');

    await expect(awaitAcceptance(submission, () => undefined)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('accepts a durable-queue receipt even on the path that expected the server', async () => {
    /**
     * The browser can be nominally ONLINE while Firestore is unreachable: the write is
     * stored in the outbox and comes back as `OfflineQueuedError`. Callers pick
     * `persistedWrite` from `navigator.onLine`, so treating that receipt as a refusal
     * rolled the person's stored edit off the screen and reported a failure for it.
     */
    const submission = persistedWrite(Promise.reject(offlineQueued()));

    await expect(awaitAcceptance(submission, () => undefined)).resolves.toEqual({
      kind: 'queued',
      receipt: 'outbox:core',
    });
  });

  it('a refusal BEFORE acceptance rejects, so the editor keeps the draft', async () => {
    const submission = persistedWrite(Promise.reject(refusal()));
    const late = jest.fn();

    await expect(awaitAcceptance(submission, late)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    // The editor is still open and owns the text, so nothing goes to the late path.
    expect(late).not.toHaveBeenCalled();
  });

  it('a refusal AFTER acceptance goes to the late path, where the recovery toast owns the text', async () => {
    let reject: (error: unknown) => void = () => undefined;
    const persistence = new Promise<void>((_resolve, rejectPersistence) => {
      reject = rejectPersistence;
    });
    const submission = queuedWrite('outbox:2', persistence);
    const late = jest.fn();

    const acceptance = await awaitAcceptance(submission, late);
    expect(acceptance.kind).toBe('queued');

    reject(refusal());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(late).toHaveBeenCalledTimes(1);
    expect(late.mock.calls[0][0]).toMatchObject({ code: 'permission-denied' });
  });

  it('a write that ALREADY failed is NOT accepted as queued', async () => {
    // Found by adversarial review: acceptance used to resolve immediately, winning the
    // microtask race against a rejection that had already happened — so the editor
    // closed over a write nothing had taken. A queued write must never outrank a
    // refusal that is already on the table.
    const submission = queuedWrite('outbox:already-failed', Promise.reject(refusal()));
    const late = jest.fn();

    await expect(awaitAcceptance(submission, late)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(late).not.toHaveBeenCalled();
  });

  it('a fast successful write is still queued — the queue is what took it', async () => {
    // Deliberate: only a REFUSAL may overtake the acceptance tick. A quick success
    // does not change who owned the write, so re-labelling it `persisted` would be a
    // different claim than the one the caller can rely on.
    const submission = queuedWrite('outbox:fast', Promise.resolve('ok'));

    await expect(awaitAcceptance(submission, () => undefined)).resolves.toEqual({
      kind: 'queued',
      receipt: 'outbox:fast',
    });
  });

  it('an offline-queued write is ACCEPTED even though the replica never shows it', async () => {
    // The defect this pins down: an offline edit is stored in the outbox (IndexedDB),
    // NOT in Firestore, so the local replica has nothing to display and `seen` never
    // resolves. Treating the resulting OfflineQueuedError as a refusal told the person
    // their successfully stored edit had failed — and rolled it back off the screen.
    const replica = { seen: new Promise<void>(() => undefined), stop: jest.fn() };
    const submission = replicaAcceptedWrite(
      'thought:offline',
      replica,
      Promise.reject(offlineQueued())
    );

    await expect(awaitAcceptance(submission, () => undefined)).resolves.toEqual({
      kind: 'queued',
      receipt: 'thought:offline',
    });
    expect(replica.stop).toHaveBeenCalled();
  });

  it('a failing replica watcher does not fail a write the server accepted', async () => {
    // A denied READ kills the snapshot listener while the WRITE succeeds. The watcher
    // used to win the race and report failure for an edit that was saved.
    const replica = { seen: Promise.reject(new Error('listener died')), stop: jest.fn() };
    const submission = replicaAcceptedWrite('thought:blind', replica, Promise.resolve('ok'));

    await expect(awaitAcceptance(submission, () => undefined)).resolves.toEqual({
      kind: 'persisted',
    });
  });

  it('a refusal still reaches the editor when the replica watcher is silent', async () => {
    const replica = { seen: new Promise<void>(() => undefined), stop: jest.fn() };
    const submission = replicaAcceptedWrite(
      'thought:refused',
      replica,
      Promise.reject(refusal())
    );

    await expect(awaitAcceptance(submission, () => undefined)).rejects.toMatchObject({
      code: 'permission-denied',
    });
    expect(replica.stop).toHaveBeenCalled();
  });

  it('does not leave an unhandled rejection when nobody observes the submission', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);

    persistedWrite(Promise.reject(refusal()));
    queuedWrite('outbox:3', Promise.reject(refusal()));
    await new Promise((resolve) => setTimeout(resolve, 10));

    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
