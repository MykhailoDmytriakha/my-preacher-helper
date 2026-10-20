// A real Admin SDK transport exercise in a disposable process, with only its clock accelerated.
// The loopback fixture implements the Firestore wire protocol; no database, Auth, or cloud is used.
const path = require('node:path');
const { createRequire } = require('node:module');
const { generateKeyPairSync } = require('node:crypto');
const realDelay = require('node:timers/promises').setTimeout;
// Fix the jitter sample, not the SDK's retry state or the response to any call.
const originalRandom = Math.random;
Math.random = () => 0.5;
const local = createRequire(path.join(__dirname, '../package.json'));
process.env.GRPC_TRACE = 'subchannel';
process.env.GRPC_VERBOSITY = 'DEBUG';
const grpcRequire = createRequire(local.resolve('google-gax'));
const grpc = grpcRequire('@grpc/grpc-js');
const { BackoffTimeout } = grpcRequire('@grpc/grpc-js/build/src/backoff-timeout');
const root = local('protobufjs').Root.fromJSON(local('@google-cloud/firestore/build/protos/v1.json'));
const requestType = root.lookupType('google.firestore.v1.BatchGetDocumentsRequest');
const responseType = root.lookupType('google.firestore.v1.BatchGetDocumentsResponse');
const title = 'Words saved before the connection failed';
const result = { harnessCompleted: false, requests: 0, baselineTitle: null, reloadTitle: null, recoveredTitle: null };
let clock, database, server, port, duringOutage = false;
const realTimer = require('node:timers').setTimeout;
const watchdog = realTimer(() => { result.setupError = 'Fixture timed out at ' + result.stage; finish(); }, 8_000);
const delays = [];
let latestFailureAt = 0;
grpc.setLogger({ error() {}, warn() {}, info() {}, debug(...args) {
  if (duringOutage && args.join(' ').includes('CONNECTING -> TRANSIENT_FAILURE')) latestFailureAt = Date.now();
} });
const originalBackoff = BackoffTimeout.prototype.runOnce;
BackoffTimeout.prototype.runOnce = function observeBackoff() {
  if (duringOutage) delays.push(this.nextDelay);
  return originalBackoff.call(this);
};

async function startServer(requestedPort) {
  const instance = new grpc.Server();
  instance.addService({ batchGetDocuments: {
    path: '/google.firestore.v1.Firestore/BatchGetDocuments', requestStream: false, responseStream: true,
    requestSerialize: value => Buffer.from(requestType.encode(value).finish()),
    requestDeserialize: bytes => requestType.decode(bytes),
    responseSerialize: value => Buffer.from(responseType.encode(value).finish()),
    responseDeserialize: bytes => responseType.decode(bytes),
  } }, { batchGetDocuments(call) {
    result.requests++;
    call.write({ found: { name: call.request.documents[0], fields: { title: { stringValue: title } },
      createTime: { seconds: 1 }, updateTime: { seconds: 1 } }, readTime: { seconds: 1 } });
    call.end();
  } });
  const assigned = await new Promise((resolve, reject) => instance.bindAsync(
    `127.0.0.1:${requestedPort}`, grpc.ServerCredentials.createInsecure(),
    (error, assignedPort) => error ? reject(error) : resolve(assignedPort)));
  return { instance, assigned };
}

async function advanceNetworkTime(ms) {
  // Real socket events keep running; only Date/setTimeout follow the accelerated clock.
  for (let advanced = 0; advanced < ms; advanced += 1_000) {
    await clock.tickAsync(Math.min(1_000, ms - advanced));
    await realDelay(5);
  }
}

async function readWithinRoute(withStore, read) {
  let outcome;
  const pending = withStore(read).then(snapshot => { outcome = { code: 'success', title: snapshot.get('title') }; },
    error => { outcome = { code: error.code || error.name, retryAfter: error.retryAfterSeconds }; });
  for (let elapsed = 0; elapsed < 4_000 && !outcome; elapsed += 100) {
    await clock.tickAsync(100); await realDelay(5);
  }
  if (!outcome) throw new Error('Route deadline did not settle');
  await pending;
  return outcome;
}

async function main() {
  result.stage = 'bind baseline';
  const initial = await startServer(0); server = initial.instance; port = initial.assigned;
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${port}`;
  process.env.GCLOUD_PROJECT = 'demo-admin-recovery';
  process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify({
    project_id: 'demo-admin-recovery', client_email: 'qa@demo-admin-recovery.iam.gserviceaccount.com', private_key: privateKey,
  })).toString('base64');
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  local('ts-node').register({ transpileOnly: true, skipProject: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'node', target: 'ES2020' } });
  local('tsconfig-paths').register({ baseUrl: path.resolve(__dirname, '..'), paths: { '@/*': ['app/*'] } });
  const configPath = path.resolve(__dirname, '../app/config/firebaseAdminConfig.ts');
  const config = require(configPath); database = config.adminDb;
  if (database._settings.servicePath !== '127.0.0.1' || database._settings.port !== port || database._settings.ssl !== false) {
    throw new Error('Actual SDK did not select the loopback fixture');
  }
  const document = () => database.collection('studyNotes').doc('qa-admin-recovery');
  result.stage = 'baseline read';
  result.baselineTitle = (await document().get()).get('title');
  // A module reload must preserve the already-used client without calling settings() again.
  delete require.cache[configPath];
  result.stage = 'module reload';
  const reloaded = require(configPath);
  if (reloaded.adminDb !== database) throw new Error('Module reload replaced the Admin client');
  result.reloadTitle = (await reloaded.adminDb.collection('studyNotes').doc('qa-admin-recovery').get()).get('title');
  const { withStore } = require(path.resolve(__dirname, '../app/services/storeAvailability.server.ts'));
  result.stage = 'start accelerated outage';
  clock = local('@sinonjs/fake-timers').install({ now: Date.now(), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  server.forceShutdown(); server = undefined;
  await realDelay(25);
  duringOutage = true;
  // Let the real route guard time out a real SDK read; its uncancelled retry keeps running.
  const outageStartedAt = Date.now();
  const firstRefusal = await readWithinRoute(withStore, () => document().get());
  result.initialRefusalCode = firstRefusal.code;
  result.initialRetryAfter = firstRefusal.retryAfter;
  let askedDuringCooldown = false;
  const cooldown = await readWithinRoute(withStore, () => { askedDuringCooldown = true; return document().get(); });
  result.cooldownRefusalCode = cooldown.code;
  result.askedDuringCooldown = askedDuringCooldown;
  result.stage = 'grow outage backoff';
  await advanceNetworkTime(180_000);
  // Restore just AFTER a late real connection failure, not at an accidentally lucky timer boundary.
  const returnBoundary = Date.now();
  for (let elapsed = 0; latestFailureAt < returnBoundary && elapsed < 180_000; elapsed += 1_000) {
    await advanceNetworkTime(1_000);
  }
  if (latestFailureAt < returnBoundary) throw new Error('No mature connection failure observed');
  result.outageDurationMs = Date.now() - outageStartedAt;
  result.stage = 'last actual route refusal';
  const lastRefusal = await readWithinRoute(withStore, () => document().get());
  result.lastRefusalCode = lastRefusal.code;
  result.lastRetryAfter = lastRefusal.retryAfter;
  result.returnAfterConnectionFailureMs = Date.now() - latestFailureAt;
  result.outageMaxBackoffMs = Math.max(...delays);
  result.backoffAtReturnMs = delays.at(-1);
  if (!delays.length) throw new Error('No real reconnect backoff observed');
  result.stage = 'rebind returned server';
  const restored = await startServer(port); server = restored.instance;
  // Let the same client live through the app's advertised 30-second pause.
  result.stage = 'advertised pause';
  await advanceNetworkTime(30_000);
  duringOutage = false;
  result.stage = 'bounded recovery read';
  const recovery = await readWithinRoute(withStore, () => document().get());
  result.recoveredTitle = recovery.title || null;
  result.recoveryCode = recovery.code;
  result.harnessCompleted = true;
}

function finish() {
  require('node:timers').clearTimeout(watchdog);
  server?.forceShutdown();
  clock?.uninstall();
  BackoffTimeout.prototype.runOnce = originalBackoff;
  Math.random = originalRandom;
  // Discard this process's deliberately unfinished SDK retry, never a shared app/client or write.
  process.stdout.write(JSON.stringify(result) + '\n', () => process.exit(0));
}

main().catch(error => { result.setupError = error.stack || error.message; }).finally(finish);
