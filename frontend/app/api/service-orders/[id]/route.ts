import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { adminDb } from '@/config/firebaseAdminConfig';

import { noStore, stepsSchema, writeError } from '../writeSupport';

import type { ServiceOrder } from '@/models/models';

type Context = { params: Promise<{ id: string }> };
const payloadSchema = z.discriminatedUnion('aggregate', [
  z.object({ aggregate: z.literal('steps'), expectedRevision: z.number().int().nonnegative(), steps: stepsSchema }).strict(),
  z.object({
    aggregate: z.literal('meta'),
    expectedRevision: z.number().int().nonnegative().nullable(),
    expectedBaseline: z.record(z.unknown()).nullable(),
    updates: z.object({ title: z.string().optional(), summary: z.string().optional() }).strict(),
  }).strict(),
]);

export async function GET(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const snapshot = await adminDb.collection('serviceOrders').doc(id).get();
    if (!snapshot.exists || snapshot.data()?.userId !== uid) {
      return NextResponse.json({ error: 'Service order not found' }, { status: 404 });
    }
    return NextResponse.json({ ...snapshot.data(), id }, { headers: noStore });
  } catch (error) { return writeError(error); }
}

/** The caller rebuilds steps from GET; the transaction refuses a superseded base. */
export async function PATCH(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid service order patch' }, { status: 400 });
  try {
    const { id } = await params;
    const input = parsed.data;
    const ref = adminDb.collection('serviceOrders').doc(id);
    const result = await adminDb.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()?.userId !== uid) {
        throw Object.assign(new Error('Service order not found'), { code: 'not-found' });
      }
      const current = { ...snapshot.data(), id } as ServiceOrder;
      const revision = current.rev?.[input.aggregate] ?? 0;
      const baselineMatches = input.aggregate === 'meta' && input.expectedBaseline !== null
        && Object.keys(input.updates).every(key => current[key as 'title' | 'summary'] === input.expectedBaseline?.[key]);
      if (input.expectedRevision !== null && input.expectedRevision !== revision && !baselineMatches) {
        return { conflict: true, current };
      }
      const patch = input.aggregate === 'steps' ? { steps: input.steps } : input.updates;
      const updatedAt = new Date().toISOString();
      tx.update(ref, { ...patch, updatedAt, [`rev.${input.aggregate}`]: revision + 1 });
      return { conflict: false, current: { ...current, ...patch, updatedAt, rev: { ...current.rev, [input.aggregate]: revision + 1 } } };
    });
    return NextResponse.json(result.current, { status: result.conflict ? 409 : 200, headers: noStore });
  } catch (error) { return writeError(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const ref = adminDb.collection('serviceOrders').doc(id);
    await adminDb.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists || snapshot.data()?.userId !== uid) {
        throw Object.assign(new Error('Service order not found'), { code: 'not-found' });
      }
      tx.delete(ref);
    });
    return NextResponse.json({ saved: true }, { headers: noStore });
  } catch (error) { return writeError(error); }
}
