import { runInNewContext } from 'node:vm';

import { OFFLINE_WORKER_START_SCRIPT } from '@/utils/offlineWorkerStartup';

function browser({ supported = true, rejects = false } = {}) {
  const page = new EventTarget() as EventTarget & { __mphOfflineWorkerReady?: Promise<void> };
  const worker = Object.assign(new EventTarget(), { state: 'installing' as ServiceWorkerState });
  const registration = Object.assign(new EventTarget(), { installing: worker as typeof worker | null, waiting: null, active: null });
  const register = jest.fn(async () => {
    if (rejects) throw new Error('Worker blocked');
    return registration;
  });
  const workers = Object.assign(new EventTarget(), { controller: null as typeof worker | null, register });
  const navigator = supported ? { serviceWorker: workers, onLine: true } : { onLine: true };
  const start = () => runInNewContext(OFFLINE_WORKER_START_SCRIPT, { window: page, navigator, caches: {} });
  return { page, worker, workers, register, registration, start };
}

const flushRegistration = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('registers once during HTML startup and waits for the controlling worker to activate', async () => {
  const { page, worker, workers, register, start } = browser();
  start();
  start();
  const ready = jest.fn();
  void page.__mphOfflineWorkerReady?.then(ready);
  await flushRegistration();
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  expect(ready).not.toHaveBeenCalled();

  worker.state = 'activating';
  workers.controller = worker;
  workers.dispatchEvent(new Event('controllerchange'));
  await flushRegistration();
  expect(ready).not.toHaveBeenCalled();

  worker.state = 'activated';
  worker.dispatchEvent(new Event('statechange'));
  await page.__mphOfflineWorkerReady;
  expect(ready).toHaveBeenCalledTimes(1);
});

it.each(['registration rejected', 'installation failed', 'installation already gone', 'went offline'])('releases online reading when startup cannot finish: %s', async reason => {
  const { page, worker, registration, start } = browser({ rejects: reason === 'registration rejected' });
  if (reason === 'installation already gone') registration.installing = null;
  start();
  const ready = jest.fn();
  void page.__mphOfflineWorkerReady?.then(ready);
  await flushRegistration();
  if (reason === 'installation failed') {
    worker.state = 'redundant';
    worker.dispatchEvent(new Event('statechange'));
  } else if (reason === 'went offline') {
    page.dispatchEvent(new Event('offline'));
  }
  await page.__mphOfflineWorkerReady;
  expect(ready).toHaveBeenCalledTimes(1);
});

it('does not hold reading if the worker API is unavailable', () => {
  const { page, start, register } = browser({ supported: false });
  start();
  expect(page.__mphOfflineWorkerReady).toBeUndefined();
  expect(register).not.toHaveBeenCalled();
});
