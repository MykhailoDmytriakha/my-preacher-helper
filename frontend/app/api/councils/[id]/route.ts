import { NextResponse } from 'next/server';

import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { refuseLegacyWriteRoute } from '@/data-engine/legacyBoundary.server';
import { councilsRepository } from '@repositories/councils.repository';

import { noStore, writeError } from '../writeSupport';

type Context = { params: Promise<{ id: string }> };


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

/**
 * PUT and DELETE stay for shipped bundles. Councils are written only through the data engine, so
 * both answer with the 426 refusal — never 409, which the shipped council client reads as
 * "conflict, the body is the current council" and drops the person's text.
 */
export async function PUT(request: Request) {
  return refuseLegacyWriteRoute(request);
}

export async function DELETE(request: Request) {
  return refuseLegacyWriteRoute(request);
}
