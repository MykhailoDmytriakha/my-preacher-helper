import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves the absolute path of `<filename>` inside the active
 * `npm run dev` log session, or `null` if no session is active (which is
 * the normal state outside dev, or when `init-dev-log-session.js` hasn't
 * run yet).
 *
 * `<repo-root>/.logs/.current-session` is the pointer file populated by
 * the predev hook; we read it positionally relative to `process.cwd()`,
 * which is the `frontend/` package when Next is started normally.
 *
 * Both the client-bridge endpoint and the server-side logger share this
 * resolver so the location is defined exactly once.
 */
export function resolveSessionLogPath(filename: 'frontend.log' | 'backend.log'): string | null {
  const pointer = path.resolve(process.cwd(), '..', '.logs/.current-session');
  if (!existsSync(pointer)) return null;
  try {
    const sessionDir = readFileSync(pointer, 'utf8').trim();
    return path.join(sessionDir, filename);
  } catch {
    return null;
  }
}
