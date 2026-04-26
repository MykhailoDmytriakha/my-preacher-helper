import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  installServerOutputLogger,
  resetServerOutputLoggerForTests,
} from '@/utils/serverOutputLogger';

import type { WriteStreamLike } from '@/utils/serverOutputLogger';

const FIXED_DATE = new Date('2026-04-25T10:11:12.345Z');
const TIMESTAMP = '[2026-04-25 10:11:12.345]';
const FIXED_SESSION_FILE = 'server-2026-04-25_10-11-12.345-pid-4321-port-3001.log';

const createStream = () => {
  let output = '';

  const stream: WriteStreamLike = {
    write: jest.fn((chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }),
  };

  return {
    output: () => output,
    stream,
  };
};

describe('serverOutputLogger', () => {
  afterEach(() => {
    resetServerOutputLoggerForTests();
  });

  it('mirrors local development server output to a timestamped log file', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'server-output-logger-'));
    const stdout = createStream();
    const stderr = createStream();

    const result = installServerOutputLogger({
      argv: ['node', 'next', 'dev', '-p', '3001'],
      cwd,
      env: { NODE_ENV: 'development' },
      now: () => FIXED_DATE,
      pid: 4321,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    stdout.stream.write('server ready\n');
    stderr.stream.write('route failed\n');

    const logFilePath = path.join(cwd, '.local-logs', 'sessions', FIXED_SESSION_FILE);
    const logFile = fs.readFileSync(logFilePath, 'utf8');

    expect(result).toEqual({
      fileLoggingEnabled: true,
      installed: true,
      logFilePath,
      port: '3001',
      reason: undefined,
    });
    expect(stdout.output()).toBe(`${TIMESTAMP} server ready\n`);
    expect(stderr.output()).toBe(`${TIMESTAMP} route failed\n`);
    expect(logFile).toContain(`${TIMESTAMP} [session] local dev server session started\n`);
    expect(logFile).toContain(`${TIMESTAMP} [session] pid: 4321\n`);
    expect(logFile).toContain(`${TIMESTAMP} [session] configured port: 3001\n`);
    expect(logFile).toContain(`${TIMESTAMP} server ready\n`);
    expect(logFile).toContain(`${TIMESTAMP} route failed\n`);
  });

  it('records the detected Next local URL when it differs from the default port', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'server-output-logger-'));
    const stdout = createStream();
    const stderr = createStream();

    const result = installServerOutputLogger({
      argv: ['node', 'next', 'dev'],
      cwd,
      env: { NODE_ENV: 'development' },
      now: () => FIXED_DATE,
      pid: 4321,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    stdout.stream.write('   - Local:        http://localhost:3004\n');

    const logFilePath = path.join(
      cwd,
      '.local-logs',
      'sessions',
      'server-2026-04-25_10-11-12.345-pid-4321-port-3000.log'
    );
    const logFile = fs.readFileSync(logFilePath, 'utf8');

    expect(result.port).toBe('3000');
    expect(logFile).toContain(`${TIMESTAMP} [session] configured port: 3000\n`);
    expect(logFile).toContain(
      `${TIMESTAMP} [session] detected local URL: http://localhost:3004 (port 3004)\n`
    );
  });

  it('does not create file logs in production', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'server-output-logger-'));
    const stdout = createStream();
    const stderr = createStream();

    const result = installServerOutputLogger({
      cwd,
      env: { NODE_ENV: 'production' },
      now: () => FIXED_DATE,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    stdout.stream.write('production output\n');

    expect(result.fileLoggingEnabled).toBe(false);
    expect(result.logFilePath).toBeUndefined();
    expect(stdout.output()).toBe(`${TIMESTAMP} production output\n`);
    expect(fs.existsSync(path.join(cwd, '.local-logs'))).toBe(false);
  });

  it('installs only once per process', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'server-output-logger-'));
    const stdout = createStream();
    const stderr = createStream();

    installServerOutputLogger({
      argv: ['node', 'next', 'dev', '--port=3001'],
      cwd,
      env: { NODE_ENV: 'development' },
      now: () => FIXED_DATE,
      pid: 4321,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    const secondResult = installServerOutputLogger({
      argv: ['node', 'next', 'dev', '--port=3001'],
      cwd,
      env: { NODE_ENV: 'development' },
      now: () => FIXED_DATE,
      pid: 4321,
      stderr: stderr.stream,
      stdout: stdout.stream,
    });

    stdout.stream.write('single patch\n');

    expect(secondResult.reason).toBe('already-installed');
    expect(stdout.output()).toBe(`${TIMESTAMP} single patch\n`);
  });
});
