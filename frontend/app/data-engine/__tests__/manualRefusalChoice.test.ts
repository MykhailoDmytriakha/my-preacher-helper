import { describeManualSync, type SyncStatus } from '@/data-engine/status';

/**
 * A form resolves only its fields, so after a refusal it does not offer the server's version of the
 * whole document — that choice belongs to the screen's editor (Codex, round 2 of
 * BUG-20260813-late-refusal-silent-after-navigation: the form kept the refused fields and reopening failed).
 */
it('does not offer "use the server version" to a form after a refusal', () => {
  const parent = { phase: 'refused', canAcceptRemote: true, canKeepLocal: true, canSave: false, canRemove: false } as unknown as SyncStatus;
  expect(describeManualSync(null, null, parent, null)?.canAcceptRemote).toBe(false);
  expect(describeManualSync(null, null, { ...parent, phase: 'conflict' } as SyncStatus, null)?.canAcceptRemote).toBe(true);
});

/** Codex, round 4: a newer version from elsewhere (an edit or a deletion) is still a choice the form has. */
it('still offers a form the newer version from elsewhere after a refusal', () => {
  const parent = { phase: 'refused', hasForeignChange: true, canAcceptRemote: true, canKeepLocal: false, canSave: false, canRemove: false } as unknown as SyncStatus;
  expect(describeManualSync(null, null, parent, null)?.canAcceptRemote).toBe(true);
});

