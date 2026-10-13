import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/** POST /api/prayer — prayer requests are created only through the data engine; a shipped bundle's create gets the refusal. */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
