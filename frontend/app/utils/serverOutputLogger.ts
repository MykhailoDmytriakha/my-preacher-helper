const LOCAL_LOG_DIR = '.local-logs';
const LOCAL_LOG_SESSION_DIR = 'sessions';
const TIMESTAMP_PATTERN = /^\[20\d\d-/;
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const LOCAL_URL_PATTERN = /Local:\s+(https?:\/\/[^\s]+:(\d+))/;
const STATE_KEY = Symbol.for('my-preacher-helper.server-output-logger');
const DEFAULT_NEXT_DEV_PORT = '3000';

type StreamChunk = string | Uint8Array;
type WriteCallback = (error?: Error | null) => void;
type WriteEncodingOrCallback = BufferEncoding | WriteCallback;

export type WriteStreamLike = {
  write: (
    chunk: StreamChunk,
    encodingOrCallback?: WriteEncodingOrCallback,
    callback?: WriteCallback
  ) => boolean;
};

type FileSystemLike = Pick<typeof import('fs'), 'appendFileSync' | 'mkdirSync'>;
type PathLike = Pick<typeof import('path'), 'dirname' | 'join' | 'resolve'>;

type ServerOutputLoggerState = {
  installed: boolean;
  stdout?: WriteStreamLike;
  stderr?: WriteStreamLike;
  stdoutOriginal?: WriteStreamLike['write'];
  stderrOriginal?: WriteStreamLike['write'];
  detectedPort?: string;
  fileSystem?: FileSystemLike;
  logFilePath?: string;
};

export type ServerOutputLoggerOptions = {
  argv?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fileSystem?: FileSystemLike;
  now?: () => Date;
  pathModule?: PathLike;
  pid?: number;
  stderr?: WriteStreamLike;
  stdout?: WriteStreamLike;
};

export type ServerOutputLoggerResult = {
  fileLoggingEnabled: boolean;
  installed: boolean;
  logFilePath?: string;
  port?: string;
  reason?: string;
};

const getStateHolder = (): Record<symbol, ServerOutputLoggerState | undefined> =>
  globalThis as unknown as Record<symbol, ServerOutputLoggerState | undefined>;

const getState = (): ServerOutputLoggerState => {
  const holder = getStateHolder();
  holder[STATE_KEY] = holder[STATE_KEY] ?? { installed: false };
  return holder[STATE_KEY];
};

const shouldMirrorToLocalFile = (env: NodeJS.ProcessEnv): boolean => {
  if (env.NODE_ENV === 'production' || env.NEXT_RUNTIME === 'edge') {
    return false;
  }

  if (env.LOCAL_SERVER_FILE_LOGS === 'false') {
    return false;
  }

  return env.NODE_ENV === 'development' || env.LOCAL_SERVER_FILE_LOGS === 'true';
};

const isPortValue = (value: string | undefined): value is string =>
  Boolean(value && /^\d{2,5}$/.test(value));

const resolveConfiguredPort = (env: NodeJS.ProcessEnv, argv: string[]): string => {
  if (isPortValue(env.PORT)) {
    return env.PORT;
  }

  if (isPortValue(env.NEXT_PORT)) {
    return env.NEXT_PORT;
  }

  if (isPortValue(env.npm_config_port)) {
    return env.npm_config_port;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const nextArg = argv[index + 1];

    if ((arg === '-p' || arg === '--port') && isPortValue(nextArg)) {
      return nextArg;
    }

    const inlineMatch = arg.match(/^(?:-p|--port)=(\d{2,5})$/);
    if (inlineMatch) {
      return inlineMatch[1];
    }
  }

  return DEFAULT_NEXT_DEV_PORT;
};

const loadNodeBuiltins = (): { fileSystem: FileSystemLike; pathModule: PathLike } => {
  const nodeRequire = eval('require') as {
    (moduleName: 'fs'): typeof import('fs');
    (moduleName: 'path'): typeof import('path');
  };

  return {
    fileSystem: nodeRequire('fs'),
    pathModule: nodeRequire('path'),
  };
};

const formatSessionStamp = (date: Date): string =>
  date.toISOString().replace('T', '_').replace(/:/g, '-').replace('Z', '');

const resolveLogFilePath = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  pathModule: PathLike,
  sessionStartedAt: Date,
  pid: number,
  port: string
): string => {
  if (env.LOCAL_SERVER_LOG_FILE?.trim()) {
    return pathModule.resolve(cwd, env.LOCAL_SERVER_LOG_FILE);
  }

  const baseLogDir = env.LOCAL_SERVER_LOG_DIR?.trim()
    ? pathModule.resolve(cwd, env.LOCAL_SERVER_LOG_DIR)
    : pathModule.join(cwd, LOCAL_LOG_DIR);
  const logDir = pathModule.join(baseLogDir, LOCAL_LOG_SESSION_DIR);
  const logFileName = `server-${formatSessionStamp(sessionStartedAt)}-pid-${pid}-port-${port}.log`;

  return pathModule.join(logDir, logFileName);
};

const timestamp = (date: Date): string =>
  `[${date.toISOString().replace('T', ' ').slice(0, 23)}]`;

const addTimestampToText = (text: string, date: Date): string =>
  text.replace(/^.+$/gm, (line) =>
    TIMESTAMP_PATTERN.test(line) ? line : `${timestamp(date)} ${line}`
  );

const writeSessionLine = (
  fileSystem: FileSystemLike,
  logFilePath: string,
  now: () => Date,
  message: string
): void => {
  fileSystem.appendFileSync(logFilePath, `${timestamp(now())} [session] ${message}\n`, 'utf8');
};

const maybeRecordDetectedPort = (
  state: ServerOutputLoggerState,
  logText: string,
  now: () => Date
): void => {
  if (!state.fileSystem || !state.logFilePath) {
    return;
  }

  const cleanText = logText.replace(ANSI_PATTERN, '');
  const match = cleanText.match(LOCAL_URL_PATTERN);
  if (!match || state.detectedPort === match[2]) {
    return;
  }

  state.detectedPort = match[2];
  writeSessionLine(
    state.fileSystem,
    state.logFilePath,
    now,
    `detected local URL: ${match[1]} (port ${match[2]})`
  );
};

const chunkToText = (
  chunk: StreamChunk,
  encodingOrCallback?: WriteEncodingOrCallback
): string | null => {
  if (typeof chunk === 'string') {
    return chunk;
  }

  try {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8';
    return Buffer.from(chunk).toString(encoding);
  } catch {
    return null;
  }
};

const createPatchedWrite = (
  originalWrite: WriteStreamLike['write'],
  state: ServerOutputLoggerState,
  now: () => Date
): WriteStreamLike['write'] => {
  return function patchedWrite(
    this: WriteStreamLike,
    chunk: StreamChunk,
    encodingOrCallback?: WriteEncodingOrCallback,
    callback?: WriteCallback
  ): boolean {
    const logDate = now();
    const outputChunk = typeof chunk === 'string' ? addTimestampToText(chunk, logDate) : chunk;

    if (state.logFilePath && state.fileSystem) {
      const logText = chunkToText(chunk, encodingOrCallback);
      if (logText) {
        try {
          state.fileSystem.appendFileSync(state.logFilePath, addTimestampToText(logText, logDate), 'utf8');
          maybeRecordDetectedPort(state, logText, now);
        } catch {
          // Local file logging must never break normal server output.
        }
      }
    }

    return originalWrite.call(this, outputChunk, encodingOrCallback, callback);
  };
};

export function installServerOutputLogger(
  options: ServerOutputLoggerOptions = {}
): ServerOutputLoggerResult {
  const state = getState();
  if (state.installed) {
    return {
      fileLoggingEnabled: Boolean(state.logFilePath),
      installed: true,
      logFilePath: state.logFilePath,
      port: state.detectedPort,
      reason: 'already-installed',
    };
  }

  const stdout = options.stdout ?? (process.stdout as unknown as WriteStreamLike);
  const stderr = options.stderr ?? (process.stderr as unknown as WriteStreamLike);

  if (!stdout?.write || !stderr?.write) {
    return {
      fileLoggingEnabled: false,
      installed: false,
      reason: 'missing-stdio',
    };
  }

  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const now = options.now ?? (() => new Date());
  const sessionStartedAt = now();
  const cwd = options.cwd ?? process.cwd();
  const pid = options.pid ?? process.pid;
  const configuredPort = resolveConfiguredPort(env, argv);
  let logFilePath: string | undefined;
  let logFileSystem: FileSystemLike | null = null;
  let fileLoggingEnabled = false;
  let reason: string | undefined;

  if (shouldMirrorToLocalFile(env)) {
    const builtins = options.fileSystem && options.pathModule ? null : loadNodeBuiltins();
    const fileSystem = options.fileSystem ?? builtins!.fileSystem;
    const pathModule = options.pathModule ?? builtins!.pathModule;
    const candidatePath = resolveLogFilePath(cwd, env, pathModule, sessionStartedAt, pid, configuredPort);
    try {
      fileSystem.mkdirSync(pathModule.dirname(candidatePath), { recursive: true });
      fileSystem.appendFileSync(candidatePath, '', 'utf8');
      logFilePath = candidatePath;
      logFileSystem = fileSystem;
      fileLoggingEnabled = true;
      writeSessionLine(fileSystem, candidatePath, now, 'local dev server session started');
      writeSessionLine(fileSystem, candidatePath, now, `pid: ${pid}`);
      writeSessionLine(fileSystem, candidatePath, now, `configured port: ${configuredPort}`);
      writeSessionLine(fileSystem, candidatePath, now, `cwd: ${cwd}`);
    } catch {
      reason = 'file-unavailable';
    }
  }

  state.installed = true;
  state.stdout = stdout;
  state.stderr = stderr;
  state.stdoutOriginal = stdout.write;
  state.stderrOriginal = stderr.write;
  state.detectedPort = configuredPort;
  state.fileSystem = logFileSystem ?? undefined;
  state.logFilePath = logFilePath;

  stdout.write = createPatchedWrite(stdout.write, state, now);
  stderr.write = createPatchedWrite(stderr.write, state, now);

  return {
    fileLoggingEnabled,
    installed: true,
    logFilePath,
    port: state.detectedPort,
    reason,
  };
}

export function resetServerOutputLoggerForTests(): void {
  const holder = getStateHolder();
  const state = holder[STATE_KEY];

  if (state?.stdout && state.stdoutOriginal) {
    state.stdout.write = state.stdoutOriginal;
  }

  if (state?.stderr && state.stderrOriginal) {
    state.stderr.write = state.stderrOriginal;
  }

  delete holder[STATE_KEY];
}
