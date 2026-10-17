/** @jest-environment node */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface PrecacheEntry { url: string; revision: string; }

const linkedIcons = [
  ['/favicon.ico', 'app/favicon.ico'],
  ['/icons/favicon.svg', 'public/icons/favicon.svg'],
  ['/icons/apple-touch-icon.png', 'public/icons/apple-touch-icon.png'],
  ['/icons/icon-192.png', 'public/icons/icon-192.png'],
  ['/icons/icon-512.png', 'public/icons/icon-512.png'],
  ['/icons/icon-maskable-512.png', 'public/icons/icon-maskable-512.png'],
] as const;

// Resolve the actual Next/Serwist build options. The callback cleans its public
// directory, so invoke it in our own disposable project, never the real app.
const inspectConfig = String.raw`
  import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import path from 'node:path';
  import { createRequire } from 'node:module';
  import { pathToFileURL } from 'node:url';
  const root = process.cwd();
  const require = createRequire(path.join(root, 'package.json'));
  const compiled = require('next/dist/compiled/webpack/webpack');
  compiled.init();
  const { default: config } = await import(pathToFileURL(path.join(root, 'next.config.mjs')).href);
  const dir = mkdtempSync(path.join(tmpdir(), 'mph-precache-options-'));
  try {
    mkdirSync(path.join(dir, 'public'));
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { types: ['@serwist/next/typings'] },
    }));
    const resolved = config.webpack(
      { plugins: [], entry: async () => ({}), output: { publicPath: '/_next/' } },
      { dir, dev: false, isServer: false, config: { basePath: '/' }, webpack: compiled.webpack },
    );
    const plugin = resolved.plugins.find(item => item.constructor.name === 'InjectManifest');
    if (!plugin) throw new Error('Production service worker plugin is missing');
    process.stdout.write('\nPWA_PRECACHE_OPTIONS:' + JSON.stringify(plugin.config.additionalPrecacheEntries) + '\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
`;

let entries: PrecacheEntry[];

beforeAll(() => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', inspectConfig], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8', timeout: 20_000,
  });
  const line = output.split('\n').find(value => value.startsWith('PWA_PRECACHE_OPTIONS:'));
  if (!line) throw new Error('Service worker options were not returned');
  entries = JSON.parse(line.slice('PWA_PRECACHE_OPTIONS:'.length)) as PrecacheEntry[];
}, 30_000);

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
