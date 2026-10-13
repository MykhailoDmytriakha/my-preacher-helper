import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/** Tags are written only through the data engine; a shipped bundle's delete gets the refusal. */
export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
