import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/**
 * POST /api/sermons stays for shipped bundles. Sermons are created only through the data engine,
 * so an old bundle's create gets the 426 refusal.
 */
export async function POST(request: Request) {
  return refuseLegacyWriteRoute(request);
}
