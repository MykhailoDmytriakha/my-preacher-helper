import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';

import { noStore, writeError } from '../writeSupport';

const schema = z.object({ ranks: z.array(z.object({ id: z.string().min(1).max(200).refine(id => !id.includes('/')), rank: z.number().finite() }).strict()).min(1).max(500) }).strict();

export async function PATCH(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data.ranks.map(entry => entry.id)).size !== parsed.data.ranks.length) {
    return NextResponse.json({ error: 'Invalid placement' }, { status: 400 });
  }
  try {
    await adminDb.runTransaction(async tx => {
      const refs = parsed.data.ranks.map(entry => adminDb.collection('serviceOrders').doc(entry.id));
      const snapshots = await tx.getAll(...refs);
      if (snapshots.some(snapshot => !snapshot.exists || snapshot.data()?.userId !== uid)) {
        throw Object.assign(new Error('Service order not found'), { code: 'not-found' });
      }
      const updatedAt = new Date().toISOString();
      snapshots.forEach((snapshot, index) => {
        tx.update(refs[index], { rank: parsed.data.ranks[index].rank, updatedAt, 'rev.placement': (snapshot.data()?.rev?.placement ?? 0) + 1 });
      });
    });
    return NextResponse.json({ saved: true }, { headers: noStore });
  } catch (error) { return writeError(error); }
}
