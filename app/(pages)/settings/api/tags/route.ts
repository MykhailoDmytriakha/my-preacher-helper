import { NextResponse } from 'next/server';
import { getTags } from '@services/setting.service';

export async function GET(request: Request) {
  const tags = getTags();
  return NextResponse.json(tags);
} 