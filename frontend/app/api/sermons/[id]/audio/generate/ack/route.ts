import { NextRequest, NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { acknowledgeAudioExport, AudioExportError } from '@/data-engine/serverOperations.server';

/** Acknowledges bytes already received; it never admits or starts provider work. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const uid = await getRequiredAuthenticatedUid(request);
    if (!uid) return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
    const body = await request.json();
    if (typeof body?.exportId !== 'string') return NextResponse.json({ error: 'Audio export identity is required' }, { status: 400 });
    await acknowledgeAudioExport(uid, (await params).id, body.exportId);
    return NextResponse.json({ acknowledged: true });
  } catch (error) {
    if (error instanceof AudioExportError) return NextResponse.json({ code: error.code, error: error.message }, { status: error.code === 'audio-export-missing' ? 400 : 409 });
    console.error('[TTS] Audio cache acknowledgement failed');
    return NextResponse.json({ error: 'Audio cache cleanup could not be completed' }, { status: 500 });
  }
}
