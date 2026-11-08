import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, readActionClockChallenge, readDocument, serverErrorResponse } from '@/data-engine/server';
import { withStore } from '@/services/storeAvailability.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ collection: string; id: string }> }): Promise<Response> {
  const startedAt = performance.now();
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    const resource = await context.params;
    assertDataEngineEnabled(resource.collection);
    const challenge = readActionClockChallenge(resource.collection, request.headers, true);
    const snapshot = await withStore(() => challenge ? readDocument(owner, resource, { actionClockChallenge: challenge }) : readDocument(owner, resource), { startedAt });
    return Response.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
