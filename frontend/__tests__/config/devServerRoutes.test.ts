import fs from 'fs';
import path from 'path';

/**
 * The dev server must not drop compiled routes after a short pause (BUG-20261014-offline-banner-after-idle-tab).
 *
 * Next's default drops a route after 60 s without requests and compiles it again on the next one.
 * After 75 s of pause, five requests of a returning tab took 16 s each (2026-10-14), past the
 * client's 5 s (metadata) and 8 s (the connectivity knock) deadlines: the app read them as "not
 * reached" and showed "Working offline" on localhost only. The server's own behaviour cannot run in
 * jest; this guards the setting that prevents it.
 */
describe('the dev server keeps routes compiled', () => {
  const config = fs.readFileSync(path.join(__dirname, '../../next.config.mjs'), 'utf8');

  it('for longer than any pause a person takes, in development only', () => {
    const setting = /process\.env\.NODE_ENV === "development"\s*\?\s*\{\s*onDemandEntries:\s*\{\s*maxInactiveAge:\s*([\d\s*]+),/.exec(config);
    expect(setting).not.toBeNull();
    const keptMs = (setting?.[1] ?? '0').split('*').reduce((product, factor) => product * Number(factor.trim()), 1);
    expect(keptMs).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});
