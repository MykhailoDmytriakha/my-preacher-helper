import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/** Orders of service are written only through the data engine; a shipped bundle's a custom order gets the refusal. */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
