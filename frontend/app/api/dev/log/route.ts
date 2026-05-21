import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

/*
 * Bridge endpoint for the client-side debug logger. Accepts a JSONL line and
 * appends it to `.logs/<session>/frontend.log`.
 *
 * Production guard: returns 404 outside development so no log surface exists
 * on the deployed app — keeps prod console + filesystem clean.
 */

// Strictly `development` — not `!== production` — so `test` and `production`
// both return 404 (no log surface in test runs, none on the deployed app).
const IS_DEV = process.env.NODE_ENV === 'development';

let cachedTarget: string | null = null;

function resolveTarget(): string | null {
  if (!IS_DEV) return null;
  // Cache positive resolutions only; if the pointer file appears later
  // (e.g. a session was started after the server was already running),
  // we re-check on each call until it materialises.
  if (cachedTarget) return cachedTarget;
  try {
    // Pointer lives at the repo root (one level above the frontend cwd) so
    // both frontend.log and backend.log share a single per-dev-run folder.
    const pointer = path.resolve(process.cwd(), '..', '.logs/.current-session');
    if (!existsSync(pointer)) return null;
    const sessionDir = readFileSync(pointer, 'utf8').trim();
    cachedTarget = path.join(sessionDir, 'frontend.log');
    return cachedTarget;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!IS_DEV) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  const target = resolveTarget();
  if (!target) {
    // No active session — silently no-op so the client doesn't error.
    return NextResponse.json({ ok: true, written: false });
  }
  try {
    const body = await request.json();
    const entry = {
      ts: new Date().toISOString(),
      side: 'frontend',
      scope: typeof body?.scope === 'string' ? body.scope : 'unknown',
      level: typeof body?.level === 'string' ? body.level : 'log',
      message: typeof body?.message === 'string' ? body.message : '',
      args: Array.isArray(body?.args) ? body.args : [],
      url: typeof body?.url === 'string' ? body.url : undefined,
    };
    await fs.appendFile(target, JSON.stringify(entry) + '\n', 'utf8');
    return NextResponse.json({ ok: true, written: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    );
  }
}
