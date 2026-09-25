import { NextResponse } from 'next/server';
import { processCommand, readDocument } from '@/data-engine/server';

/** Mounted only by the local browser validation launcher. */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188'
    || process.env.DATA_ENGINE_BROWSER_FIXTURE !== 'true') return NextResponse.json({ error: 'Fixture disabled' }, { status: 404 });
  try {
    const body = await request.json(), owner = 'browser-integration';
    if (body.action === 'read') return NextResponse.json(await readDocument(owner, body.resource));
    if (body.action === 'seed') {
      const result = await processCommand(owner, { protocol: 1, operationId: crypto.randomUUID(), owner, resource: body.resource, generation: null, dependsOn: [], kind: 'create', value: {
        userId: owner, title: 'Browser sermon', verse: 'John 1:1', date: '2026-09-12', thoughts: [],
        scratch: ['a', 'b'].map(id => ({ id, text: `Original ${id}`, createdAt: '2026-09-12T00:00:00.000Z' })),
      } });
      return NextResponse.json(result, { status: result.kind === 'acknowledged' ? 200 : 409 });
    }
    if (body.action === 'command') {
      const result = await processCommand(owner, body.command);
      if (body.dropResponse) return NextResponse.json({ error: 'Simulated response loss after commit' }, { status: 503 });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: String(error) }, { status: 500 }); }
}
