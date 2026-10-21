import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * THE PAGE TALKS TO ITS OWN DOMAIN.
 *
 * A request to our API is a path (`/api/…`): the browser sends it to the domain the page came from,
 * so `my-preacher-helper.com` asks `.com` and `my-preacher-helper.vercel.app` asks `vercel.app`, and
 * the browser's cross-origin check (CORS) never stands between a page and its own server.
 *
 * Nine services once prefixed their paths with `NEXT_PUBLIC_API_BASE`, set in production to the
 * vercel.app address while the app was served on `.com`. Every such request was cross-origin, held up
 * only by the server's list of allowed headers; the interface-language header added on 2026-10-17 was
 * not on it, and the browser blocked the AI helpers, the share links and the note cut on `.com`. The
 * blocked request read as "no connection", its knock as "connection back", and an open note re-read
 * its lists every ~4 s (BUG-20261021-language-header-blocked-cross-origin).
 */
const APP = join(__dirname, '..', '..', 'app');
/** Absolute addresses of an `/api/` that is not ours: an AI provider's own API. */
const OTHER_APIS = new Set(['openrouter.ai']);
const ABSOLUTE_API = /https?:\/\/([^/'"`\s]+)[^'"`\s]*?\/api\//g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

describe('requests to our API go to the page\'s own domain', () => {
  it('reads no API address from the environment', () => {
    const offenders = sourceFiles(APP)
      .filter(file => readFileSync(file, 'utf8').includes('NEXT_PUBLIC_API_BASE'))
      .map(file => relative(APP, file));
    expect(offenders).toEqual([]);
  });

  it('writes no absolute address to our API', () => {
    const offenders = sourceFiles(APP).flatMap(file => [...readFileSync(file, 'utf8').matchAll(ABSOLUTE_API)]
      .filter(([, host]) => !OTHER_APIS.has(host))
      .map(([address]) => `${relative(APP, file)}: ${address}`));
    expect(offenders).toEqual([]);
  });
});
