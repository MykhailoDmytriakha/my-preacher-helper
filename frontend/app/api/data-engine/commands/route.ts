import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, commandCollection, processCommand, readCommandBody, serverErrorResponse } from '@/data-engine/server';
import { withStore } from '@/services/storeAvailability.server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    assertDataEngineEnabled();
    const body = await readCommandBody(request);
    assertDataEngineEnabled(commandCollection(body));
    const result = await withStore(() => processCommand(owner, body), { write: true, startedAt });
    // Old clients only project the link. The note effect still commits, enters the feed and
    // stays in the canonical receipt for clients that support caching both documents.
    const legacyRevoke = (body as { relation?: unknown } | null)?.relation === 'share-link-revoke'
      && new URL(request.url).searchParams.get('shareNoteReceipt') !== '1';
    const response = legacyRevoke && result.kind === 'acknowledged'
      ? { ...result, affected: undefined, relatedSnapshots: undefined } : result;
    return Response.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
