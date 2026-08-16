import { NextResponse } from 'next/server';

export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}

/**
 * WHICH BUILD THIS SERVER IS CURRENTLY SERVING.
 *
 * Added for `AppUpdateButton`, which must answer "is the code in this tab out of date?" —
 * and that question has exactly one honest form: compare the version baked into the running
 * bundle with the version the server is handing out now. It used to be answered by listening
 * for the service worker's `controllerchange`, which reports that a new worker took charge
 * and says nothing about which code the tab is running. Measured on production: a page that
 * had loaded the NEW build at second one was offered an update at second 256.
 *
 * `NEXT_PUBLIC_APP_VERSION` is the same value the version badge in settings shows
 * (`next.config.mjs`), so the two never disagree about what "this build" means.
 *
 * `no-store` because a cached answer here is precisely the wrong answer: it would report the
 * build that was current when the cache was filled.
 */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', version: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
