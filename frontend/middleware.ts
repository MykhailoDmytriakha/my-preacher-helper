import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://my-preacher-helper.com',
  'https://www.my-preacher-helper.com',
  'https://my-preacher-helper.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function getAllowedOrigins(): string[] {
  const env = process.env.CORS_ALLOWED_ORIGINS;
  if (!env?.trim()) return DEFAULT_ALLOWED_ORIGINS;
  return env.split(',').map((o) => o.trim()).filter(Boolean);
}

function getCorsHeaders(request: NextRequest): Headers {
  const origin = request.headers.get('origin');
  const allowed = getAllowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : null;

  const headers = new Headers();
  if (allowOrigin) {
    headers.set('Access-Control-Allow-Origin', allowOrigin);
  }
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const corsHeaders = getCorsHeaders(request);

  // Preflight: respond immediately with CORS headers
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  const response = NextResponse.next();
  corsHeaders.forEach((value, key) => response.headers.set(key, value));
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
