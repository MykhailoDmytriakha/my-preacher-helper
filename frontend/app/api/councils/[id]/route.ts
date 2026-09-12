import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { councilsRepository } from '@repositories/councils.repository';

import { councilBodySchema, noStore, writeError } from '../writeSupport';

type Context = { params: Promise<{ id: string }> };

const replaceSchema = z
  .object({ council: councilBodySchema, expectedRev: z.number().int().nonnegative().nullable() })
  .strict();

export async function GET(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    const council = await councilsRepository.getForOwner(uid, id);
    if (!council) return NextResponse.json({ error: 'Council not found' }, { status: 404 });
    return NextResponse.json(council, { headers: noStore });
  } catch (error) {
    return writeError(error);
  }
}

/** PUT /api/councils/:id — the whole council, refused with 409 when built on a superseded base. */
export async function PUT(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = replaceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid council' }, { status: 400 });
  try {
    const { id } = await params;
    const result = await councilsRepository.replaceForOwner(uid, id, parsed.data.council, parsed.data.expectedRev);
    return NextResponse.json(result.current, { status: result.conflict ? 409 : 200, headers: noStore });
  } catch (error) {
    return writeError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const uid = await getRequiredAuthenticatedUid(request);
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const { id } = await params;
    await councilsRepository.deleteForOwner(uid, id);
    return NextResponse.json({ deleted: true }, { headers: noStore });
  } catch (error) {
    return writeError(error);
  }
}
