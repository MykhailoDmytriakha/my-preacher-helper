/** @jest-environment node */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface PrecacheEntry { url: string; revision: string; }
interface ProbeResult {
  name: string;
  entries?: PrecacheEntry[];
  error?: string;
}

const linkedIcons = [
  ['/favicon.ico', 'app/favicon.ico'],
  ['/icons/favicon.svg', 'public/icons/favicon.svg'],
  ['/icons/apple-touch-icon.png', 'public/icons/apple-touch-icon.png'],
  ['/icons/icon-192.png', 'public/icons/icon-192.png'],
  ['/icons/icon-512.png', 'public/icons/icon-512.png'],
  ['/icons/icon-maskable-512.png', 'public/icons/icon-maskable-512.png'],
] as const;

// Resolve production Serwist options and run its public manifest transformer
// with synthetic metadata plus a minimal webpack-shaped compilation. Keep this
// in a disposable config project; next.config's webpack callback cleans public.
const inspectConfig = String.raw`
  import { createRequire } from 'node:module';
  import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
  import { runInNewContext } from 'node:vm';
  import { tmpdir } from 'node:os';
  import path from 'node:path';
  import { pathToFileURL } from 'node:url';

  const root = process.cwd();
  const require = createRequire(path.join(root, 'package.json'));
  const compiled = require('next/dist/compiled/webpack/webpack');
  compiled.init();
  const { default: config } = await import(pathToFileURL(path.join(root, 'next.config.mjs')).href);
  const dir = mkdtempSync(path.join(tmpdir(), 'mph-precache-options-'));
  try {
    mkdirSync(path.join(dir, 'public'));
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { types: ['@serwist/next/typings'] } }));
    const resolved = config.webpack(
      { plugins: [], entry: async () => ({}), output: { publicPath: '/_next/' } },
      { dir, dev: false, isServer: false, config: { basePath: '/' }, webpack: compiled.webpack },
    );
    const plugin = resolved.plugins.find(item => item.constructor.name === 'InjectManifest');
    if (!plugin) throw new Error('Production service worker plugin is missing');
    const { transformManifest } = await import('@serwist/build');
    const identityEntries = plugin.config.additionalPrecacheEntries;
    // Execute the installed client entry with the actual production DefinePlugin values.
    // Its optional helper must not add another HTML writer beside our RSC/shell owners.
    const defined = Object.assign({}, ...resolved.plugins.filter(item => item.definitions).map(item => item.definitions));
    const flags = {};
    for (const [key, expression] of Object.entries(defined)) {
      if (key.startsWith('self.__SERWIST_SW_ENTRY.')) flags[key.split('.').pop()] = expression === undefined ? undefined : new Function('return (' + expression + ')')();
    }
    const workers = [], messages = [], registrations = [], events = {};
    const push = () => {}, replace = () => {};
    const history = { pushState: push, replaceState: replace };
    const navigator = { serviceWorker: {}, onLine: true };
    const window = { __SERWIST_SW_ENTRY: flags, navigator, location: { origin: 'https://app.test', pathname: '/groups' }, addEventListener: (name, callback) => { events[name] = callback; } };
    const entryPath = path.join(path.dirname(require.resolve('@serwist/next')), 'sw-entry.mjs');
    const entry = readFileSync(entryPath, 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export {};', '');
    class EntryWorker { constructor(url) { workers.push(url); } postMessage(message) { messages.push(message); } }
    class EntrySerwist { constructor(url, options) { this.url = url; this.scope = options.scope; } register() { registrations.push({ url: this.url, scope: this.scope }); } }
    runInNewContext(entry, { self: window, window, navigator, history, caches: {}, Worker: EntryWorker, Serwist: EntrySerwist, isCurrentPageOutOfScope: () => false });
    history.pushState({}, '', '/groups');
    history.replaceState({}, '', '/sermons');
    if (events.online) events.online();
    const entryBehavior = { workers, messages, registrations, historyPreserved: history.pushState === push && history.replaceState === replace };

    const describe = (name, bytes, { metadata = true } = {}) => {
      const content = Buffer.alloc(0);
      const source = { size: () => bytes, source: () => content };
      const asset = { name, source, info: {} };
      const file = { file: '/_next/' + name, hash: 'synthetic-' + name.replace(/[^a-z0-9]+/gi, '-'), size: bytes };
      return { asset, file: metadata ? file : null };
    };
    const run = async (name, described, compilationOnly = []) => {
      try {
        const all = [...described, ...compilationOnly];
        const compilation = {
          options: { output: { path: path.join(dir, '.next'), publicPath: '/_next/' } },
          getAssets: () => all.map(item => item.asset),
        };
        const response = await transformManifest({
          fileDetails: described.filter(item => item.file).map(item => item.file),
          additionalPrecacheEntries: plugin.config.additionalPrecacheEntries,
          dontCacheBustURLsMatching: plugin.config.dontCacheBustURLsMatching,
          manifestTransforms: plugin.config.manifestTransforms,
          maximumFileSizeToCacheInBytes: plugin.config.maximumFileSizeToCacheInBytes,
          modifyURLPrefix: plugin.config.modifyURLPrefix,
          transformParam: compilation,
          disablePrecacheManifest: plugin.config.disablePrecacheManifest,
        });
        return { name, entries: response.manifestEntries?.map(({ url, revision }) => ({ url, revision: String(revision ?? '') })) ?? [] };
      } catch (error) {
        return { name, error: String(error?.message ?? error).slice(0, 1000) };
      }
    };
    const KiB = 1024;
    const probes = [];
    probes.push(await run('small-application-code', [
      describe('static/chunks/small-application.js', 128 * KiB),
      describe('static/css/small-application.css', 128 * KiB),
    ]));
    probes.push(await run('large-js-css-under-configured-budget', [
      describe('static/chunks/large-application.js', 2.5 * 1024 * KiB),
      describe('static/css/large-application.css', 2.5 * 1024 * KiB),
    ]));
    probes.push(await run('required-js-omitted-from-file-details', [], [
      describe('static/chunks/required-but-unlisted.js', 128 * KiB, { metadata: false }),
    ]));
    probes.push(await run('required-css-omitted-from-file-details', [], [
      describe('static/css/required-but-unlisted.css', 128 * KiB, { metadata: false }),
    ]));
    probes.push(await run('over-budget-application-js', [
      describe('static/chunks/oversized-application.js', 8 * 1024 * KiB),
    ]));
    probes.push(await run('over-budget-non-code-media', [
      describe('static/media/large-optional.bin', 8 * 1024 * KiB),
    ]));
    probes.push(await run('excluded-non-app-code-assets', [], [
      describe('static/chunks/app.js.map', 64 * KiB),
      describe('static/chunks/123.hot-update.js', 64 * KiB),
      describe('sw.js', 64 * KiB),
      describe('swe-worker-example.js', 64 * KiB),
      describe('static/media/illustration.png', 64 * KiB),
    ]));
    process.stdout.write('\nPWA_PRECACHE_PROBES:' + JSON.stringify({ identityEntries, probes, entryBehavior }) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
`;

let entryBehavior: { workers: string[]; messages: unknown[]; registrations: { url: string; scope: string }[]; historyPreserved: boolean };
let entries: PrecacheEntry[];
let probes: ProbeResult[];

beforeAll(() => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', inspectConfig], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8', timeout: 20_000,
  });
  const line = output.split('\n').find(value => value.startsWith('PWA_PRECACHE_PROBES:'));
  if (!line) throw new Error('Service worker probes were not returned');
  const payload = JSON.parse(line.slice('PWA_PRECACHE_PROBES:'.length)) as { identityEntries: PrecacheEntry[]; probes: ProbeResult[]; entryBehavior: typeof entryBehavior };
  entries = payload.identityEntries;
  probes = payload.probes;
  entryBehavior = payload.entryBehavior;
}, 30_000);

const probe = (name: string) => {
  const found = probes.find(item => item.name === name);
  if (!found) throw new Error(`Missing precache probe: ${name}`);
  return found;
};

describe('offline application identity resources', () => {
  it('retains the revisioned offline shell', () => {
    expect(entries).toContainEqual({ url: '/~offline', revision: expect.any(String) });
  });

  it('includes the build-revisioned installation manifest', () => {
    expect(entries).toContainEqual({ url: '/manifest.webmanifest', revision: expect.any(String) });
  });

  it.each(linkedIcons)('precaches %s with its content revision', (url, source) => {
    const content = readFileSync(path.resolve(__dirname, '..', source));
    const revision = createHash('sha256').update(content).digest('hex');
    expect(entries).toContainEqual({ url, revision });
  });

  it('keeps the explicit shell list bounded to linked identity resources', () => {
    const allowed = new Set(['/~offline', '/manifest.webmanifest', ...linkedIcons.map(([url]) => url)]);
    expect(entries.every(entry => allowed.has(entry.url))).toBe(true);
    expect(new Set(entries.map(entry => entry.url)).size).toBe(entries.length);
  });
});

describe('offline application code precache policy', () => {
  it('retains ordinary emitted application JavaScript and CSS', () => {
    const result = probe('small-application-code');
    expect(result.error).toBeUndefined();
    expect(result.entries?.map(entry => entry.url)).toEqual(expect.arrayContaining([
      '/_next/static/chunks/small-application.js', '/_next/static/css/small-application.css',
    ]));
  });

  it('retains emitted application JavaScript and CSS above the old 2 MiB default', () => {
    const result = probe('large-js-css-under-configured-budget');
    expect(result.error).toBeUndefined();
    expect(result.entries?.map(entry => entry.url)).toEqual(expect.arrayContaining([
      '/_next/static/chunks/large-application.js',
      '/_next/static/css/large-application.css',
    ]));
  });

  it('fails the build when emitted required JavaScript is missing from manifest inputs', () => {
    const result = probe('required-js-omitted-from-file-details');
    expect(result.error ?? '').toMatch(/required-but-unlisted\.js/i);
  });

  it('fails the build when emitted required CSS is missing from manifest inputs', () => {
    const result = probe('required-css-omitted-from-file-details');
    expect(result.error ?? '').toMatch(/required-but-unlisted\.css/i);
  });

  it('fails the build rather than silently dropping over-budget application JavaScript', () => {
    const result = probe('over-budget-application-js');
    expect(result.error ?? '').toMatch(/oversized-application\.js/i);
  });

  it('allows large non-code media to remain outside the application-code manifest contract', () => {
    const result = probe('over-budget-non-code-media');
    expect(result.error).toBeUndefined();
    expect(result.entries?.some(entry => entry.url.includes('/static/media/large-optional.bin'))).toBe(false);
  });

  it('does not require source maps, hot updates, service workers, or other non-code assets', () => {
    const result = probe('excluded-non-app-code-assets');
    expect(result.error).toBeUndefined();
  });
});


describe('one owner for offline navigation caching', () => {
  it('does not launch the optional auxiliary HTML worker or dispatch duplicate cache messages', () => {
    expect(entryBehavior.workers).toEqual([]);
    expect(entryBehavior.messages).toEqual([]);
  });

  it('leaves native history with the router instead of wrapping it for another cache', () => {
    expect(entryBehavior.historyPreserved).toBe(true);
  });

  it('still registers the actual application service worker', () => {
    expect(entryBehavior.registrations).toEqual([{ url: 'https://app.test/sw.js', scope: '/' }]);
  });
});
