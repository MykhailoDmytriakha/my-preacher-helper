/**
 * Generate Google (Gemini) TTS voice samples for the audio-export voice picker.
 *
 * For each curated male voice × Gemini model × language it calls the Gemini TTS
 * API, wraps the returned PCM into a WAV file, and writes it to
 * public/samples/{voice}-{modelShort}-{lang}.wav (skipping files that exist).
 *
 * OpenAI voices are NOT touched — only the Google feature adds samples.
 *
 * Usage:  node scripts/generate-voice-samples.mjs
 * Env:    GEMINI_API_KEY (read from .env.local or the environment).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'public', 'samples');

// --- load GEMINI_API_KEY from .env.local if not already in env ---------------
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
            } else {
                v = v.replace(/\s+#.*$/, '').trim(); // strip inline comment for unquoted values
            }
            if (v) return v;
        }
    }
    return undefined;
}

const GEMINI_API_KEY = loadEnvKey('GEMINI_API_KEY');
if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not found in env or .env.local — aborting.');
    process.exit(1);
}

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

const MODELS = [
    { id: 'gemini-3.1-flash-tts-preview', short: '3.1' },
    { id: 'gemini-2.5-flash-preview-tts', short: '2.5' },
];
const VOICES = ['Puck', 'Iapetus', 'Orus', 'Charon'];
const SAMPLE_TEXT = {
    ru: 'Благодать вам и мир от Бога, Отца нашего, и Господа Иисуса Христа.',
    en: 'Grace to you and peace from God our Father and the Lord Jesus Christ.',
    uk: 'Благодать вам і мир від Бога, Отця нашого, і Господа Ісуса Христа.',
};

function pcm16ToWav(pcm, sampleRate = 24000, channels = 1, bytesPerSample = 2) {
    const dataSize = pcm.length;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
    buf.writeUInt16LE(channels * bytesPerSample, 32);
    buf.writeUInt16LE(bytesPerSample * 8, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataSize, 40);
    pcm.copy(buf, 44);
    return buf;
}

async function synth(model, voice, text, attempt = 1) {
    const res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
        }),
    });
    if (!res.ok) {
        const errText = await res.text();
        // Back off and retry transient throttling / server errors.
        if ((res.status === 429 || res.status >= 500) && attempt < 4) {
            const waitMs = 2000 * attempt;
            console.log(`  ↻ ${res.status}, retry ${attempt}/3 in ${waitMs}ms`);
            await sleep(waitMs);
            return synth(model, voice, text, attempt + 1);
        }
        throw new Error(`${res.status}: ${errText.slice(0, 200)}`);
    }
    const payload = await res.json();
    const part = payload?.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data || p.inline_data?.data
    );
    const b64 = part?.inlineData?.data || part?.inline_data?.data;
    if (!b64) throw new Error('No audio data in response');
    return Buffer.from(b64, 'base64');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    fs.mkdirSync(SAMPLES_DIR, { recursive: true });
    let made = 0, skipped = 0, failed = 0;

    for (const model of MODELS) {
        for (const voice of VOICES) {
            for (const lang of Object.keys(SAMPLE_TEXT)) {
                const filename = `${voice}-${model.short}-${lang}.wav`;
                const outPath = path.join(SAMPLES_DIR, filename);
                if (fs.existsSync(outPath)) { skipped++; continue; }
                try {
                    const pcm = await synth(model.id, voice, SAMPLE_TEXT[lang]);
                    fs.writeFileSync(outPath, pcm16ToWav(pcm));
                    made++;
                    console.log(`✓ ${filename} (${pcm.length} bytes pcm)`);
                } catch (err) {
                    failed++;
                    console.error(`✗ ${filename}: ${err.message}`);
                }
                await sleep(400);
            }
        }
    }
    console.log(`\nDone. made=${made} skipped=${skipped} failed=${failed}`);
    process.exitCode = failed > 0 ? 1 : 0;
})();
