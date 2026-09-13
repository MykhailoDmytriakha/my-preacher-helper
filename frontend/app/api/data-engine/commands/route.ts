import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { assertDataEngineEnabled, commandCollection, processCommand, readCommandBody, serverErrorResponse } from '@/data-engine/server';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const owner = await getRequiredAuthenticatedUid(request);
  if (!owner) return Response.json({ code: 'unauthenticated' }, { status: 401 });
  try {
    assertDataEngineEnabled();
    const body = await readCommandBody(request);
    assertDataEngineEnabled(commandCollection(body));
    const result = await processCommand(owner, body);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return serverErrorResponse(error);
  }
}
