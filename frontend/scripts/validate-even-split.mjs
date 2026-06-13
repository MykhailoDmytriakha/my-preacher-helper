/**
 * READ-ONLY validation: apply the even-split rule to every REAL outline point in the
 * DB and show before→after chunk sizes. NO audio is generated — pure text arithmetic.
 *
 * The splitTextEvenly copy below mirrors app/api/clients/tts.client.ts exactly; the
 * canonical version is guarded by app/api/clients/__tests__/splitTextEvenly.test.ts.
 *
 * Usage: node scripts/validate-even-split.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnvKey(name) {
  if (process.env[name]) return process.env[name];
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = raw.match(re);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v) return v;
    }
  }
  return null;
}

// ---- mirror of tts.client.ts splitTextEvenly (canonical guarded by Jest) ----
const EVEN_SPLIT_IDEAL_SIZE = 1750;
const EVEN_SPLIT_HARD_MAX = 4000;
const splitBySentences = (text) => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
function splitByWords(sentence, maxSize) {
  const chunks = [];
  let wordChunk = '';
  for (const word of sentence.split(/\s+/)) {
    if ((wordChunk + ' ' + word).length > maxSize) {
      if (wordChunk.trim()) chunks.push(wordChunk.trim());
      wordChunk = word;
    } else wordChunk = wordChunk ? wordChunk + ' ' + word : word;
  }
  if (wordChunk.trim()) chunks.push(wordChunk.trim());
  return chunks;
}
function splitTextEvenly(text, idealSize = EVEN_SPLIT_IDEAL_SIZE) {
  const clean = text.trim();
  if (!clean) return [];
  const n = Math.max(1, Math.round(clean.length / idealSize));
  if (n === 1) return [clean];
  const sentences = splitBySentences(clean);
  if (sentences.length <= 1) return splitByWords(clean, Math.ceil(clean.length / n));
  const target = clean.length / n;
  const buckets = Array.from({ length: n }, () => '');
  let pos = 0;
  for (const sentence of sentences) {
    const bucket = Math.min(n - 1, Math.floor((pos + sentence.length / 2) / target));
    buckets[bucket] = buckets[bucket] ? `${buckets[bucket]} ${sentence}` : sentence;
    pos += sentence.length + 1;
  }
  const result = [];
  for (const bucket of buckets) {
    const t = bucket.trim();
    if (!t) continue;
    if (t.length > EVEN_SPLIT_HARD_MAX) result.push(...splitByWords(t, idealSize));
    else result.push(t);
  }
  return result;
}
// -----------------------------------------------------------------------------

const CHARS_PER_SEC = 950 / 60;
const toSec = (n) => Math.round(n / CHARS_PER_SEC);

const sa = loadEnvKey('FIREBASE_SERVICE_ACCOUNT');
const serviceAccount = JSON.parse(Buffer.from(sa, 'base64').toString());
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const snap = await db.collection('sermons').get();
const SECTIONS = ['introduction', 'main', 'conclusion'];

const pointTexts = [];
for (const doc of snap.docs) {
  const s = doc.data();
  const thoughts = Array.isArray(s.thoughts) ? s.thoughts : [];
  const outline = s.outline || {};
  const byPoint = new Map();
  for (const t of thoughts) {
    if (t && t.outlinePointId) {
      const a = byPoint.get(t.outlinePointId) || [];
      a.push(t);
      byPoint.set(t.outlinePointId, a);
    }
  }
  for (const sec of SECTIONS) {
    const pts = Array.isArray(outline[sec]) ? outline[sec] : [];
    for (const p of pts) {
      const text = (byPoint.get(p.id) || []).map((t) => t.text || '').join('\n\n').trim();
      if (text) pointTexts.push(text);
    }
  }
}

let splitCount = 0;
const afterChunkLens = [];
let worst = { before: 0, chunks: [] };
let maxChunkAfter = 0;
let overCap = 0; // chunks exceeding OpenAI 4096

for (const text of pointTexts) {
  const chunks = splitTextEvenly(text);
  if (chunks.length > 1) splitCount++;
  for (const c of chunks) {
    afterChunkLens.push(c.length);
    if (c.length > maxChunkAfter) maxChunkAfter = c.length;
    if (c.length > 4096) overCap++;
  }
  if (text.length > worst.before) worst = { before: text.length, chunks: chunks.map((c) => c.length) };
}

function stats(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const sum = a.reduce((p, c) => p + c, 0);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { n: a.length, avg: Math.round(sum / a.length), p90: q(0.9), max: a[a.length - 1] };
}

console.log(`\n=== EVEN-SPLIT validation on ${pointTexts.length} real outline points (NO audio) ===\n`);
console.log(`points that get sub-split (>1 chunk): ${splitCount}  (${(100 * splitCount / pointTexts.length).toFixed(1)}%)`);
console.log(`points unchanged (1 chunk):           ${pointTexts.length - splitCount}\n`);

const before = stats(pointTexts.map((t) => t.length));
const after = stats(afterChunkLens);
console.log(`BEFORE (per point):  n=${before.n}  avg=${before.avg} (~${toSec(before.avg)}s)  p90=${before.p90} (~${toSec(before.p90)}s)  MAX=${before.max} (~${toSec(before.max)}s)`);
console.log(`AFTER  (per chunk):  n=${after.n}  avg=${after.avg} (~${toSec(after.avg)}s)  p90=${after.p90} (~${toSec(after.p90)}s)  MAX=${after.max} (~${toSec(after.max)}s)`);

console.log(`\nworst point: ${worst.before} chars (~${toSec(worst.before)}s)  →  ${worst.chunks.length} chunks: [${worst.chunks.join(', ')}]  (~${worst.chunks.map(toSec).join('s, ')}s)`);

console.log(`\n--- invariants ---`);
console.log(`max chunk after even-split: ${maxChunkAfter} chars (~${toSec(maxChunkAfter)}s)  ${maxChunkAfter <= 2625 + 200 ? 'OK (≤ ~2625 round-boundary + 1 sentence)' : '⚠️ TOO BIG'}`);
console.log(`chunks over OpenAI 4096 cap: ${overCap}  ${overCap === 0 ? 'OK' : '⚠️ VIOLATION'}`);

// histogram after
console.log(`\n=== histogram of chunk size AFTER even-split ===`);
const buckets = [0, 500, 1000, 1500, 2000, 2625, 3000, 1e9];
for (let i = 0; i < buckets.length - 1; i++) {
  const c = afterChunkLens.filter((n) => n >= buckets[i] && n < buckets[i + 1]).length;
  const bar = '█'.repeat(Math.round(40 * c / afterChunkLens.length));
  const hi = buckets[i + 1] === 1e9 ? '+' : `-${buckets[i + 1]}`;
  console.log(`   ${String(buckets[i]).padStart(5)}${hi.padEnd(6)} | ${String(c).padStart(4)} ${bar}`);
}

process.exit(0);
