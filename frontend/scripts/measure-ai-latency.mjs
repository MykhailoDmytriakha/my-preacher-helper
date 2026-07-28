/**
 * READ-ONLY measurement: сколько РЕАЛЬНО длятся AI-вызовы в проде?
 *
 * Читает коллекцию `ai_prompt_telemetry` (её пишет `app/api/clients/aiTelemetry.ts`
 * на каждом вызове через `callWithStructuredOutput`) и считает по каждому промпту:
 * n / min / median / p90 / max задержки, долю вызовов за 10 секунд и разбивку
 * статусов. Нужно, чтобы решать `maxDuration` в `vercel.json` по ЧИСЛУ, а не по
 * рассуждению: роут без записи в конфиге получает дефолт Hobby = 10s, и всё, что
 * длиннее, умирает на полуслове.
 *
 * Живой источник, а не таблица в документации: список промптов и их задержки
 * берутся из базы, поэтому не устаревают вместе с этим файлом.
 *
 * ⚠️ БЕЗОПАСНОСТЬ: `FIREBASE_SERVICE_ACCOUNT` хранится в base64. Разбор обёрнут в
 * try/catch, и наружу НЕ печатается ни исходная строка, ни `error.message` —
 * сообщение парсера содержит фрагмент входа, то есть сам приватный ключ. Именно
 * так ключ утёк в лог сессии 2026-07-25 (запись в BUGS.md).
 *
 * Usage: node scripts/measure-ai-latency.mjs [--days=30]
 * NEVER writes. Only reads `ai_prompt_telemetry`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const daysArg = process.argv.find((a) => a.startsWith('--days='));
const WINDOW_DAYS = daysArg ? Number(daysArg.split('=')[1]) : null;
const DEFAULT_CAP_MS = 10_000;

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
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return v;
    }
  }
  return null;
}

function loadServiceAccount() {
  const value = loadEnvKey('FIREBASE_SERVICE_ACCOUNT');
  if (!value) {
    console.error('FIREBASE_SERVICE_ACCOUNT не найден в окружении или .env.local');
    process.exit(1);
  }
  const decoded = value.trimStart().startsWith('{')
    ? value
    : Buffer.from(value, 'base64').toString('utf8');
  try {
    return JSON.parse(decoded);
  } catch {
    // Детали НЕ печатаем: сообщение парсера содержит приватный ключ.
    console.error('Не удалось разобрать service-account (детали скрыты намеренно)');
    process.exit(1);
  }
}

/**
 * Человеческие имена берём из реестра `app/api/clients/ai/promptRegistry.ts`.
 * Скрипт на чистом JS и импортировать TypeScript не может, поэтому читает файл
 * и вынимает пары «ключ → display» и «старое имя → ключ» разбором текста.
 * Не разобралось — работаем на сырых ключах: они и сами говорящие.
 */
function loadRegistry() {
  const file = path.join(ROOT, 'app', 'api', 'clients', 'ai', 'promptRegistry.ts');
  const display = new Map();
  const legacy = new Map();
  if (!fs.existsSync(file)) return { display, legacy };

  const text = fs.readFileSync(file, 'utf8');
  const entry = /"([a-z][a-z0-9_.]+)":\s*\{([\s\S]*?)\n {2}\}/g;
  let match;
  while ((match = entry.exec(text)) !== null) {
    const [, key, body] = match;
    const displayMatch = body.match(/display:\s*"([^"]+)"/);
    if (displayMatch) display.set(key, displayMatch[1]);
    const legacyMatch = body.match(/legacyNames:\s*\[([^\]]*)\]/);
    if (legacyMatch) {
      for (const raw of legacyMatch[1].matchAll(/"([^"]+)"/g)) legacy.set(raw[1], key);
    }
  }
  return { display, legacy };
}

function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
  return { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

const sec = (ms) => `${(ms / 1000).toFixed(1)}s`;

admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
const db = admin.firestore();

const collection = process.env.AI_TELEMETRY_COLLECTION || 'ai_prompt_telemetry';
const cutoff = WINDOW_DAYS ? new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString() : null;

// Фильтр по дате отдаём базе, а не себе, и тянем ТОЛЬКО нужные поля: документ
// телеметрии весит ~21 KB (в нём лежит текст промпта и ответа), и без проекции
// один прогон качал бы всю коллекцию целиком — на 10 000 событий это сотни
// мегабайт трафика и пятая часть дневного лимита чтений.
let query = db.collection(collection).select('promptName', 'latencyMs', 'status', 'jsonStructureStatus', 'phase', 'timestamp');
if (cutoff) query = query.where('timestamp', '>=', cutoff);
const snap = await query.get();

const { display: DISPLAY, legacy: LEGACY } = loadRegistry();
const byPrompt = new Map();
let minTs = null;
let maxTs = null;

snap.forEach((doc) => {
  const e = doc.data();
  const rawName = e.promptName || '(без имени)';
  // События до переименования сводим к текущему ключу, иначе один промпт
  // разъедется на две строки.
  const name = LEGACY.get(rawName) || rawName;
  if (!byPrompt.has(name)) byPrompt.set(name, { lat: [], status: {} });
  const b = byPrompt.get(name);
  if (typeof e.latencyMs === 'number') b.lat.push(e.latencyMs);
  const st = e.jsonStructureStatus || e.status || '?';
  b.status[st] = (b.status[st] || 0) + 1;
  if (e.timestamp) {
    if (!minTs || e.timestamp < minTs) minTs = e.timestamp;
    if (!maxTs || e.timestamp > maxTs) maxTs = e.timestamp;
  }
});

console.log(`\n=== ${collection}: ${snap.size} событий всего${WINDOW_DAYS ? `, окно ${WINDOW_DAYS} дн.` : ''} ===`);
console.log(`период выборки: ${minTs} → ${maxTs}\n`);

const rows = [...byPrompt.entries()]
  .map(([name, b]) => ({ name, st: stats(b.lat), b }))
  .filter((r) => r.st)
  .sort((a, b) => b.st.p50 - a.st.p50);

const header =
  'ключ'.padEnd(42) + 'n'.padStart(5) + 'min'.padStart(9) + 'p50'.padStart(10) +
  'p90'.padStart(9) + 'max'.padStart(9) + '   >10s'.padEnd(15) + 'статусы';
console.log(header);
console.log('-'.repeat(header.length));

for (const { name, st, b } of rows) {
  const over = b.lat.filter((v) => v > DEFAULT_CAP_MS).length;
  const pct = ((100 * over) / b.lat.length).toFixed(0);
  // Сперва человеческое имя — по нему видно, где в приложении это происходит;
  // ключ идёт следом, потому что им адресуют админку и логи.
  console.log(`\n${DISPLAY.get(name) || name}`);
  console.log(
    ('  ' + name).padEnd(42) + String(st.n).padStart(5) + sec(st.min).padStart(9) +
    sec(st.p50).padStart(10) + sec(st.p90).padStart(9) + sec(st.max).padStart(9) +
    `   ${over}/${b.lat.length} (${pct}%)`.padEnd(15) + JSON.stringify(b.status)
  );
}

console.log(`\nПорог сравнения — дефолт Hobby ${DEFAULT_CAP_MS / 1000}s: всё, что выше, в проде убивается,`);
console.log('если роут не перечислен в vercel.json (гейт — __tests__/config/vercel-functions.test.ts).');
console.log('Промпт, которого нет в таблице, за этот период не вызывался ни разу.\n');

process.exit(0);
