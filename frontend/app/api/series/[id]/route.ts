import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/**
 * DELETE /api/series/:id stays for shipped bundles. Series are deleted only through the data engine,
 * which also detaches their sermons and groups, so a shipped bundle's delete gets the 426 refusal.
 */
export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
