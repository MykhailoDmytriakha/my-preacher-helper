import { runtimeErrorDetails, safeRuntimeErrorMetadata } from '@/utils/runtimeErrorDetails';

const location = { origin: 'https://example.com', pathname: '/sermons/private-id/plan/manual', search: '?source=note&planView=preaching&secret=private' };

it('identifies a production React failure and prefers its application frame', () => {
  const error = new Error('Minified React error #185; private note text');
  error.stack = 'Error: private note text\n at a (https://example.com/_next/static/chunks/123-abcdef12.js:1:22)\n at b (https://example.com/_next/static/chunks/app/plan/page-1234abcd.js?secret=private:3:44)';
  const details = runtimeErrorDetails({ error }, location, '82b5e9d');
  expect(details).toEqual({ code: 'javascript', route: location.pathname, errorType: 'Error', reactCode: 185,
    asset: 'page-1234abcd.js', line: 3, column: 44, planView: 'preaching', planSource: 'note', version: '82b5e9d' });
  expect(JSON.stringify(details)).not.toMatch(/private note text|secret=|https:/);
});

it('uses ErrorEvent coordinates and classifies Safari module failures', () => {
  expect(runtimeErrorDetails({ message: 'Importing a module script failed.', filename: 'https://example.com/_next/static/chunks/webpack-1234abcd.js', lineno: 1, colno: 20 }, location, 'dev'))
    .toEqual(expect.objectContaining({ code: 'chunk-load', asset: 'webpack-1234abcd.js', line: 1, column: 20 }));
});

it('omits foreign scripts, arbitrary filenames, user text and invalid metadata', () => {
  const error = Object.assign(new Error('private'), { name: 'private-name', stack: 'Error: private\n at x (https://foreign.example/_next/static/chunks/page-1234abcd.js:1:2)' });
  const details = runtimeErrorDetails({ error, filename: 'https://example.com/uploads/private-person.js', lineno: 1, colno: 2 }, { ...location, search: '?planView=private', pathname: '/dashboard' }, 'private-version');
  expect(details).toEqual({ code: 'javascript', route: '/dashboard' });
  expect(safeRuntimeErrorMetadata({ asset: 'private-person.js', errorType: 'private', line: Infinity, column: -1, reactCode: 3.2, planView: 'private', planSource: 'private', version: 'private' })).toEqual({});
});
