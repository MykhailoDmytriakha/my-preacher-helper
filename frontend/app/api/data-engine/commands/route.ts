import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, commandCollection, processCommand, readCommandBody, serverErrorResponse } from '@/data-engine/server';
import { withStore } from '@/services/storeAvailability.server';

import type { CommandResult } from '@/data-engine/types';

export const runtime = 'nodejs';

// Leave room below the hosting platform's 4.5 MB response limit.
const MAX_ACKNOWLEDGEMENT_BYTES = 4 * 1024 * 1024;

function commandResponse(result: CommandResult): Response {
  let body = JSON.stringify(result);
  if (result.kind === 'acknowledged' && result.relatedSnapshots?.length && Buffer.byteLength(body) > MAX_ACKNOWLEDGEMENT_BYTES) {
    // Keep the primary copy and every effect's proof. Clients can read the related copies separately.
    const { relatedSnapshots: _copies, ...proof } = result;
    body = JSON.stringify(proof);
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

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
    return commandResponse(response);
  } catch (error) {
    return serverErrorResponse(error);
  }
}
