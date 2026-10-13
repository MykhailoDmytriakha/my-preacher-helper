import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/**
 * PUT and DELETE stay for shipped bundles. Preach dates are written only through the data engine,
 * so an old bundle's write gets the 426 refusal.
 */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}

export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
