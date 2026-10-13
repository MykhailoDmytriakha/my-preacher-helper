import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';

/**
 * DELETE /api/groups/:id stays for shipped bundles. Groups are deleted only through the data engine,
 * which also clears the group from its series, so a shipped bundle's delete gets the 426 refusal.
 */
export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
