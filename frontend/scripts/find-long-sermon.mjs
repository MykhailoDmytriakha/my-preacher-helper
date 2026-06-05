/** READ-ONLY: for the given user, list sermons by their longest outline-point (raw thoughts). */
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
      const m = raw.match(re); if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (v) return v;
    }
  }
  return null;
}
const UID = 'Jhwh42NbpLRSoKltDdHr15QLsfJ3';
const sa = loadEnvKey('FIREBASE_SERVICE_ACCOUNT');
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(Buffer.from(sa, 'base64').toString())) });
const db = admin.firestore();
const snap = await db.collection('sermons').where('userId', '==', UID).get();
const SECTIONS = ['introduction', 'main', 'conclusion'];
const rows = [];
for (const doc of snap.docs) {
  const s = doc.data();
  const thoughts = Array.isArray(s.thoughts) ? s.thoughts : [];
  const outline = s.outline || {};
  const byPoint = new Map();
  for (const t of thoughts) if (t && t.outlinePointId) { const a = byPoint.get(t.outlinePointId) || []; a.push(t); byPoint.set(t.outlinePointId, a); }
  let maxLen = 0, nPoints = 0;
  for (const sec of SECTIONS) for (const p of (Array.isArray(outline[sec]) ? outline[sec] : [])) {
    nPoints++;
    const len = (byPoint.get(p.id) || []).map((t) => t.text || '').join('\n\n').trim().length;
    if (len > maxLen) maxLen = len;
  }
  rows.push({ id: doc.id, title: s.title || '(no title)', nPoints, maxLen });
}
rows.sort((a, b) => b.maxLen - a.maxLen);
console.log(`\nuser ${UID}: ${snap.size} sermons\n`);
for (const r of rows.slice(0, 10)) {
  const trig = r.maxLen > 2625 ? '  <-- triggers even-split (>2625)' : '';
  console.log(`${String(r.maxLen).padStart(5)} ch  | pts:${String(r.nPoints).padStart(2)} | ${r.id} | ${r.title}${trig}`);
}
process.exit(0);
