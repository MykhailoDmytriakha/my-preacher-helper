import { NextResponse } from 'next/server';

import { requireAdminEmail } from '@/api/admin/adminAuth';

export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
};

export async function GET(request: Request): Promise<NextResponse> {
  const admin = await requireAdminEmail(request);
  if (!admin.ok) return admin.response;

  return NextResponse.json({ admin: true }, { headers: NO_STORE_HEADERS });
}
