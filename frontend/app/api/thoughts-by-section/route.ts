import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/**
 * PUT /api/thoughts-by-section stays for shipped bundles. A sermon's structure is written only through
 * the data engine, so an old bundle's write gets the 426 refusal.
 */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}
