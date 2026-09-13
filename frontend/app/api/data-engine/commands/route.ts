import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, processCommand, readCommandBody, serverErrorResponse } from '@/data-engine/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    assertDataEngineEnabled();
    const result = await processCommand(owner, await readCommandBody(request));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
