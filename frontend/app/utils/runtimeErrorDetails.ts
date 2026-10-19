/** Public build coordinates and finite categories only. Never retain an error's text or stack. */
export interface RuntimeErrorMetadata {
  errorType?: string;
  asset?: string;
  line?: number;
  column?: number;
  reactCode?: number;
  planView?: string;
  planSource?: string;
  version?: string;
}

const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'SecurityError', 'InvalidStateError', 'QuotaExceededError', 'AbortError', 'ChunkLoadError']);
const PLAN_VIEWS = new Set(['editor', 'preaching', 'immersive', 'overlay']);
const PLAN_SOURCES = new Set(['note', 'manual', 'thoughts']);
// Only generated public chunk names, not arbitrary filenames or document paths.
const CHUNK_ASSET = /^(?:(?:page|layout|webpack|main-app|framework|polyfills|[a-f0-9]{1,24})-)?[a-f0-9]{6,64}\.js$/i;

const coordinate = (value: unknown): value is number => typeof value === 'number'
  && Number.isInteger(value) && value >= 0 && value <= 10_000_000;

/** Also used when reading stored events: persisted or caller-supplied fields are untrusted. */
export function safeRuntimeErrorMetadata(input: RuntimeErrorMetadata): RuntimeErrorMetadata {
  const result: RuntimeErrorMetadata = {};
  if (typeof input.errorType === 'string' && ERROR_TYPES.has(input.errorType)) result.errorType = input.errorType;
  if (typeof input.asset === 'string' && CHUNK_ASSET.test(input.asset)) result.asset = input.asset;
  if (coordinate(input.line)) result.line = input.line;
  if (coordinate(input.column)) result.column = input.column;
  if (coordinate(input.reactCode) && input.reactCode > 0 && input.reactCode < 10000) result.reactCode = input.reactCode;
  if (typeof input.planView === 'string' && PLAN_VIEWS.has(input.planView)) result.planView = input.planView;
  if (typeof input.planSource === 'string' && PLAN_SOURCES.has(input.planSource)) result.planSource = input.planSource;
  if (typeof input.version === 'string' && /^(?:dev|[a-f0-9]{7,40})$/i.test(input.version)) result.version = input.version;
  return result;
}

interface ErrorInput {
  message?: string;
  error?: unknown;
  filename?: string;
  lineno?: number;
  colno?: number;
}

function publicLocation(filename: string, origin: string, line?: number, column?: number) {
  try {
    const url = new URL(filename, origin);
    const asset = url.pathname.split('/').pop() ?? '';
    if (url.origin !== origin || !url.pathname.startsWith('/_next/static/chunks/') || !CHUNK_ASSET.test(asset)) return null;
    return { asset, line, column, app: url.pathname.includes('/chunks/app/') };
  } catch {
    return null;
  }
}

/** Classify in memory, retaining only safe coordinates that can identify the deployed code. */
export function runtimeErrorDetails(
  input: ErrorInput,
  location: Pick<Location, 'origin' | 'pathname' | 'search'>,
  version: string,
): RuntimeErrorMetadata & { code: string; route: string } {
  const error = input.error && typeof input.error === 'object'
    ? input.error as { name?: unknown; message?: unknown; stack?: unknown } : null;
  const message = input.message ?? (typeof error?.message === 'string' ? error.message : '');
  const metadata: RuntimeErrorMetadata = { version };
  if (typeof error?.name === 'string') metadata.errorType = error.name;
  const reactCode = /Minified React error #(\d{1,4})\b/.exec(message);
  if (reactCode) metadata.reactCode = Number(reactCode[1]);

  const frames = typeof error?.stack === 'string' ? [...error.stack.matchAll(/https?:\/\/[^\s)]+/g)].flatMap(([frame]) => {
    const parts = /^(.*):(\d+):(\d+)$/.exec(frame);
    const found = parts ? publicLocation(parts[1], location.origin, Number(parts[2]), Number(parts[3])) : null;
    return found ? [found] : [];
  }) : [];
  const source = frames.find(frame => frame.app) ?? frames[0]
    ?? (input.filename ? publicLocation(input.filename, location.origin, input.lineno, input.colno) : null);
  if (source) Object.assign(metadata, { asset: source.asset, line: source.line, column: source.column });

  if (/\/plan(?:\/manual)?$/.test(location.pathname)) {
    const query = new URLSearchParams(location.search);
    metadata.planView = PLAN_VIEWS.has(query.get('planView') ?? '') ? query.get('planView')! : 'editor';
    metadata.planSource = query.get('source') === 'note' ? 'note' : location.pathname.endsWith('/manual') ? 'manual' : 'thoughts';
  }
  return {
    code: /chunk|dynamically imported module|importing a module script failed/i.test(message) ? 'chunk-load' : 'javascript',
    route: location.pathname,
    ...safeRuntimeErrorMetadata(metadata),
  };
}
