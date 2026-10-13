import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { isEngineTombstone } from '@/utils/engineTombstone';

import { noStore, writeError } from '../writeSupport';

const NOT_FOUND = 'Service order not found';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const snapshot = await adminDb.collection('serviceOrders').doc(id).get();
    if (!snapshot.exists || snapshot.data()?.userId !== uid || isEngineTombstone(snapshot.data())) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    return NextResponse.json({ ...snapshot.data(), id }, { headers: noStore });
  } catch (error) { return writeError(error); }
}

/**
 * PATCH and DELETE stay for shipped bundles. Orders of service are written only through the data
 * engine, so both answer with the 426 refusal — never 409, which the shipped client reads as a
 * conflict and drops the person's text.
 */
export async function PATCH(request: Request) {
  return refuseLegacyWriteRoute(request);
}

export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
