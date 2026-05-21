#!/usr/bin/env node
/*
 * Initialises a per-`npm run dev` log session directory. Runs as a `predev`
 * hook so every dev start gets its own `.logs/logs_{timestamp}/` folder.
 *
 * Outputs:
 *   - `.logs/logs_<ISO>/`               new session folder (frontend.log + backend.log)
 *   - `.logs/latest`                    symlink to the newest session (best-effort)
 *   - `.logs/.current-session`          plain file containing the absolute path
 *                                       of the current session — server-side code
 *                                       reads this to know where to append.
 *
 * Production-clean: only ever invoked through `npm run dev`. Nothing in this
 * script runs at build / runtime in any deployed environment.
 */

const fs = require('fs');
const path = require('path');

// Session logs live at the repo root (one level above `frontend/`) so a
// single folder collects both client (frontend) and server (Next.js API
// route) log streams, plus anything a sibling `backend/` might add later.
const frontendDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(frontendDir, '..');
const logsRoot = path.join(repoRoot, '.logs');

function timestampSlug() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function main() {
  fs.mkdirSync(logsRoot, { recursive: true });

  const sessionDirName = `logs_${timestampSlug()}`;
  const sessionDir = path.join(logsRoot, sessionDirName);
  fs.mkdirSync(sessionDir, { recursive: true });

  const sessionMeta = {
    sessionId: sessionDirName,
    startedAt: new Date().toISOString(),
    nodeVersion: process.version,
    repoRoot,
    frontendDir,
  };
  fs.writeFileSync(
    path.join(sessionDir, 'session.json'),
    JSON.stringify(sessionMeta, null, 2)
  );
  fs.writeFileSync(path.join(sessionDir, 'frontend.log'), '');
  fs.writeFileSync(path.join(sessionDir, 'backend.log'), '');

  // Pointer file the server-side logger reads at request time.
  fs.writeFileSync(path.join(logsRoot, '.current-session'), sessionDir);

  // `latest` symlink for human grep convenience.
  const latestLink = path.join(logsRoot, 'latest');
  try {
    if (fs.existsSync(latestLink) || fs.lstatSync(latestLink, { throwIfNoEntry: false })) {
      fs.unlinkSync(latestLink);
    }
  } catch {
    /* not present — ignore */
  }
  try {
    fs.symlinkSync(sessionDir, latestLink, 'dir');
  } catch (err) {
    // Windows / filesystems without symlink support — keep going, the
    // pointer file is the authoritative source anyway.
    console.warn(`[init-dev-log-session] symlink to latest skipped: ${err.message}`);
  }

  console.log(`[dev-log-session] active session: ${sessionDir}`);
}

main();
