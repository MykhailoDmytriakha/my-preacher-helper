/**
 * READ-ONLY measurement: how big is one outline point (пункт плана) in practice?
 *
 * Mirrors buildGenerationSegments() raw-mode logic: for each outline point,
 * the spoken text = thoughts assigned to that point, joined by blank lines.
 * Reports avg / median / p90 / max char length + estimated audio seconds,
 * so we can pick a chunk-size that keeps each clip under the ~60-90s drift onset.
 *
 * Usage: node scripts/measure-outline-points.mjs
 * NEVER writes. Only reads the `sermons` collection.
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

const sa = loadEnvKey('FIREBASE_SERVICE_ACCOUNT');
if (!sa) { console.error('FIREBASE_SERVICE_ACCOUNT not found'); process.exit(1); }
const serviceAccount = JSON.parse(Buffer.from(sa, 'base64').toString());
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Russian narration ~150 wpm ≈ 950 chars/min ≈ 15.8 chars/sec (from estimateDuration())
const CHARS_PER_SEC = 950 / 60;
const toSec = (n) => Math.round(n / CHARS_PER_SEC);

function stats(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const sum = a.reduce((p, c) => p + c, 0);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { n: a.length, min: a[0], avg: Math.round(sum / a.length), p50: q(0.5), p90: q(0.9), p95: q(0.95), max: a[a.length - 1] };
}
function show(label, st) {
  if (!st) { console.log(`${label}: (none)`); return; }
  console.log(`${label}:`);
  console.log(`   n=${st.n}  min=${st.min}  avg=${st.avg} (~${toSec(st.avg)}s)  p50=${st.p50} (~${toSec(st.p50)}s)  p90=${st.p90} (~${toSec(st.p90)}s)  p95=${st.p95} (~${toSec(st.p95)}s)  MAX=${st.max} (~${toSec(st.max)}s)`);
}

const snap = await db.collection('sermons').get();
console.log(`\n=== sermons fetched: ${snap.size} ===`);

// --- shape of first doc (ground truth, don't assume) ---
const first = snap.docs[0]?.data() || {};
console.log('top-level keys:', Object.keys(first).join(', '));
console.log('thoughts:', Array.isArray(first.thoughts) ? `array(${first.thoughts.length})` : typeof first.thoughts);
console.log('outline keys:', first.outline ? Object.keys(first.outline).join(', ') : 'none');
if (Array.isArray(first.thoughts) && first.thoughts[0]) console.log('sample thought keys:', Object.keys(first.thoughts[0]).join(', '));

// --- measure ---
const pointLens = [];          // per outline point: joined thoughts char length (raw mode)
const orphanSectionLens = [];  // per section without points: all thoughts joined
const existingChunkLens = [];  // currently persisted audioChunks text length
let sermonsWithPoints = 0, sermonsNoPoints = 0, emptyPoints = 0;
const SECTIONS = ['introduction', 'main', 'conclusion'];

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

  let hasAnyPoint = false;
  for (const sec of SECTIONS) {
    const pts = Array.isArray(outline[sec]) ? outline[sec] : [];
    if (pts.length) hasAnyPoint = true;
    for (const p of pts) {
      const ths = byPoint.get(p.id) || [];
      const text = ths.map((t) => t.text || '').join('\n\n').trim();
      pointLens.push(text.length);
      if (text.length === 0) emptyPoints++;
    }
    if (!pts.length) {
      // section with no outline points → whole section is one segment
      const secThoughts = thoughts.filter((t) => (t.tags || []).some((tag) => String(tag).toLowerCase().includes(sec.slice(0, 4))));
      const text = secThoughts.map((t) => t.text || '').join('\n\n').trim();
      if (text.length) orphanSectionLens.push(text.length);
    }
  }
  if (hasAnyPoint) sermonsWithPoints++; else sermonsNoPoints++;

  if (Array.isArray(s.audioChunks)) for (const c of s.audioChunks) existingChunkLens.push((c.text || '').length);
}

console.log(`\n=== sermons with outline points: ${sermonsWithPoints} | without: ${sermonsNoPoints} | empty points (no thoughts): ${emptyPoints} ===\n`);
show('PER OUTLINE POINT (thoughts joined)', stats(pointLens.filter((n) => n > 0)));
show('PER SECTION w/o points (approx)', stats(orphanSectionLens));
show('EXISTING persisted audioChunks', stats(existingChunkLens));

// threshold buckets on non-empty points
const nonEmpty = pointLens.filter((n) => n > 0);
const over = (limit) => nonEmpty.filter((n) => n > limit).length;
console.log(`\n=== how many points EXCEED a quality threshold (of ${nonEmpty.length} non-empty points) ===`);
for (const [label, lim] of [['~60s (1000 ch)', 1000], ['~90s (1500 ch)', 1500], ['~2min (1900 ch)', 1900], ['~4min (3800 ch)', 3800], ['OpenAI cap (4096 ch)', 4096]]) {
  const c = over(lim);
  console.log(`   > ${label}: ${c}  (${(100 * c / nonEmpty.length).toFixed(1)}%)`);
}

// histogram
console.log(`\n=== histogram (point char length) ===`);
const buckets = [0, 500, 1000, 1500, 2000, 3000, 4000, 6000, 1e9];
for (let i = 0; i < buckets.length - 1; i++) {
  const c = nonEmpty.filter((n) => n >= buckets[i] && n < buckets[i + 1]).length;
  const bar = '█'.repeat(Math.round(40 * c / nonEmpty.length));
  const hi = buckets[i + 1] === 1e9 ? '+' : `-${buckets[i + 1]}`;
  console.log(`   ${String(buckets[i]).padStart(5)}${hi.padEnd(6)} | ${String(c).padStart(4)} ${bar}`);
}

process.exit(0);
