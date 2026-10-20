/** @jest-environment node */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

it('reads saved words after the store returns and its advertised pause ends, using the same Admin client', async () => {
  const { stdout } = await execute(process.execPath, [path.resolve(__dirname, '../../test-utils/adminFirestoreRecovery.js')], {
    cwd: path.resolve(__dirname, '../..'), timeout: 12_000,
  });
  const result = JSON.parse(stdout);
  expect(result.setupError).toBeUndefined();
  expect(result.harnessCompleted).toBe(true);
  expect(result.baselineTitle).toBe('Words saved before the connection failed');
  expect(result.reloadTitle).toBe(result.baselineTitle);
  expect(result.outageDurationMs).toBeGreaterThanOrEqual(180_000);
  expect(result.initialRefusalCode).toBe('unavailable');
  expect(result.initialRetryAfter).toBe(30);
  expect(result.cooldownRefusalCode).toBe('unavailable');
  expect(result.askedDuringCooldown).toBe(false);
  expect(result.lastRefusalCode).toBe('unavailable');
  expect(result.lastRetryAfter).toBe(30);
  expect(result.returnAfterConnectionFailureMs).toBeLessThanOrEqual(4_000);
  expect(result.backoffAtReturnMs).toBeGreaterThan(0);
  expect(result.recoveryCode).toBe('success');
  expect(result.recoveredTitle).toBe(result.baselineTitle);
});
