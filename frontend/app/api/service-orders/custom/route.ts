import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';

import { noStore, stepsSchema, writeError } from '../writeSupport';

const schema = z.object({ title: z.string().min(1), summary: z.string().optional(), steps: stepsSchema, rank: z.number().finite() }).strict();

export async function POST(request: Request) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid service order' }, { status: 400 });
  try {
    const ref = adminDb.collection('serviceOrders').doc();
    const now = new Date().toISOString();
    const order = { ...parsed.data, userId: uid, createdAt: now, updatedAt: now };
    await ref.create(order);
    return NextResponse.json({ ...order, id: ref.id }, { status: 201, headers: noStore });
  } catch (error) { return writeError(error); }
}
