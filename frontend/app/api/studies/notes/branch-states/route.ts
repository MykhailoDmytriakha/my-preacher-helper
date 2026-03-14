import { NextResponse } from 'next/server';

import { studiesRepository } from '@repositories/studies.repository';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'User not authenticated' }, { status: 401 });
  }

  try {
    const branchStates = await studiesRepository.listNoteBranchStates(userId);
    return NextResponse.json(branchStates);
  } catch (error) {
    console.error('GET /api/studies/notes/branch-states error', error);
    return NextResponse.json({ error: 'Failed to fetch study note branch states' }, { status: 500 });
  }
}
