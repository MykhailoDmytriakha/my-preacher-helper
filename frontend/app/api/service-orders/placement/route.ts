import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/** Orders of service are written only through the data engine; a shipped bundle's a reorder gets the refusal. */
export async function PATCH(request: Request) {
  return refuseLegacyWriteRoute(request);
}
