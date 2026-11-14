/** The proof field names the checkpoint codec dropped during this test (collected by jest.setup.js). */
function registry(): string[] {
  const events = (globalThis as unknown as Record<symbol, string[] | undefined>)[Symbol.for('preacher.dataEngine.droppedEvidenceEvents')];
  if (!events) throw new Error('The dropped-proof registry is installed by jest.setup.js');
  return events;
}

/** What has been dropped so far and not yet taken. */
export function droppedProof(): readonly string[] {
  return [...registry()];
}

/**
 * Take exactly these dropped field names, one occurrence each, and fail if one was not dropped. Every other
 * drop stays for the after-test check, so a test that drops proof on purpose cannot hide an unrelated drop.
 */
export function takeDroppedProof(...fields: string[]): void {
  const events = registry();
  for (const field of fields) {
    const index = events.indexOf(field);
    if (index < 0) throw new Error(`Expected the codec to drop ${field}; dropped: ${events.join(', ') || 'nothing'}`);
    events.splice(index, 1);
  }
}
