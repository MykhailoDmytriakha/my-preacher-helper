/*
 * Server-side dev logger. Appends JSONL lines to `.logs/<session>/backend.log`
 * for the active `npm run dev` session. In production, all writes are no-ops
 * so nothing escapes the dev box.
 *
 * Session directory is published by `scripts/init-dev-log-session.js` at
 * `.logs/.current-session`. We read it once per process and cache.
 */

import { promises as fs } from 'node:fs';

import { resolveSessionLogPath } from './sessionLogPath';

type Level = 'log' | 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  side: 'backend';
  scope: string;
  level: Level;
  message: string;
  args: unknown[];
}

let cachedSessionFile: string | null = null;

function resolveBackendLogPath(): string | null {
  // Strict gate: only emit during `npm run dev`. `test` and `production`
  // both no-op so neither Jest workers nor deployed servers ever touch the
  // filesystem.
  if (process.env.NODE_ENV !== 'development') return null;
  if (cachedSessionFile) return cachedSessionFile;
  cachedSessionFile = resolveSessionLogPath('backend.log');
  return cachedSessionFile;
}

function safeArgs(args: unknown[]): unknown[] {
  return args.map((value) => {
    if (value instanceof Error) {
      return { name: value.name, message: value.message, stack: value.stack };
    }
    return value;
  });
}

async function writeEntry(entry: LogEntry): Promise<void> {
  const target = resolveBackendLogPath();
  if (!target) return;
  try {
    await fs.appendFile(target, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    /* never let a logger error escape into the caller */
  }
}

export interface ServerDebugLogger {
  log(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

function emit(scope: string, level: Level, message: string, args: unknown[]): void {
  if (process.env.NODE_ENV !== 'development') return;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    side: 'backend',
    scope,
    level,
    message,
    args: safeArgs(args),
  };
  void writeEntry(entry);
}

export function createServerDebug(scope: string): ServerDebugLogger {
  return {
    log: (message, ...args) => emit(scope, 'log', message, args),
    info: (message, ...args) => emit(scope, 'info', message, args),
    warn: (message, ...args) => emit(scope, 'warn', message, args),
    error: (message, ...args) => emit(scope, 'error', message, args),
  };
}
