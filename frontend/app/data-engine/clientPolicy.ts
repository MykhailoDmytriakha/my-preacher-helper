/** Public, transport-free activation policy for React views and legacy compatibility facades. */
const listed = (value: string | undefined): string[] => (value ?? '').split(',').map(entry => entry.trim()).filter(Boolean);

export function isCollectionOnEngine(collection: string): boolean {
  return process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED === 'true'
    || listed(process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS).includes(collection);
}
export function isDataEngineEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED === 'true'
    || listed(process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS).length > 0;
}

/** Old persisted mutations retain their payload; they may not replay through a second writer. */
export function assertLegacyClientWriteAllowed(collection: string): void {
  if (isCollectionOnEngine(collection)) throw Object.assign(new Error('Use the shared DataEngine editor for this collection'), {
    code: 'data-engine-required', status: 426,
  });
}
