// Keep the per-file installation budget bounded, including the emitted application code.
export const APP_CODE_PRECACHE_BYTES = 4 * 1024 * 1024;

const isApplicationCode = name => (
  (name.startsWith('static/chunks/') && name.endsWith('.js') && !name.endsWith('.hot-update.js'))
  || (name.startsWith('static/css/') && name.endsWith('.css'))
);

const resourceKey = url => decodeURIComponent(new URL(url, 'https://precache.invalid/').href);

/** A filtered-out code chunk must fail the build rather than strand an already viewed page offline. */
export function requireAppCodePrecache(entries, compilation) {
  if (!compilation || typeof compilation.getAssets !== 'function') {
    throw new Error('Application-code precache validation requires a webpack compilation');
  }
  const publicPath = compilation.options?.output?.publicPath ?? '';
  if (typeof publicPath !== 'string' || publicPath === 'auto') {
    throw new Error('Application-code precache validation requires an explicit webpack public path');
  }
  const prefix = publicPath && !publicPath.endsWith('/') ? publicPath + '/' : publicPath;
  const retained = new Set(entries.map(entry => resourceKey(entry.url)));
  const missing = compilation.getAssets()
    .map(asset => asset.name)
    .filter(isApplicationCode)
    .filter(name => !retained.has(resourceKey(prefix + name)))
    .sort();
  if (missing.length) {
    throw new Error('Required application code is missing from the offline precache: ' + missing.join(', '));
  }
  return { manifest: entries, warnings: [] };
}
