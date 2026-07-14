# OpenRouter Model Research — TEXT + TRANSCRIPTION

## ⭐ FINAL LOCKED SET — 3 processing modes × 3 languages (en/ru/UK) — deep-research 2026-07-13
Five deep passes (2 Claude + 3 Codex, all web-cited, cross-checked). Ukrainian (the app's 3rd locale) was added as an equal axis and **materially changed the picture** — several en/ru picks don't do Ukrainian. Confidence is honestly graded; UK rests on thin public evidence → real tests required before locking (below).

### TEXT (generation: polish · plans · warm rewrite) — all OpenRouter
- tier1 `deepseek/deepseek-v4-flash` $0.09/$0.18 — bulk cleanup (+"keep original language" instruction; DeepSeek drifts to EN on long RU/UK).
- tier2 `google/gemini-3.1-flash-lite` $0.25/$1.50 — fast JSON scaffolding (NOT warm prose).
- **tier3 DEFAULT `qwen/qwen3.7-plus` $0.32/$1.28 ⭐** — warm rewrite. **en/ru: medium-high confidence** (exact-model RU test scored 94/A). **uk: PROVISIONAL, low confidence** — no public test of long warm Ukrainian prose exists for any candidate; Qwen wins by absence-of-a-proven-better, not proof.
- tier4 `deepseek/deepseek-v4-pro` $0.435/$0.87 — hardest long-form; also the **UK challenger** (family has the best UK-empathy signal + output cheaper than Qwen) — split UK to it only if a blind sermon read confirms.
- Price now confirmed; Qwen $0.32 = 20%-off promo (list $0.40/$1.60), "preview" status, JSON `response_format` untested.

### STT (transcription: audio→text)
| Lang | Default | Premium |
|---|---|---|
| en | `groq/whisper-large-v3` $0.111/hr | `MAI-Transcribe-1.5` $0.36/hr |
| ru | `groq/whisper-large-v3` $0.111/hr | `MAI-Transcribe-1.5` $0.36/hr |
| **uk** | **`openai/gpt-4o-mini-transcribe` $0.18/hr** | **`MAI-Transcribe-1.5` $0.36/hr** |
- **NOT turbo** ($0.04) — pruned decoder degrades RU/UK (uk 22.83% vs 20.53% full v3).
- **MAI-Transcribe-1 does NOT support Ukrainian**; the **NEW `MAI-Transcribe-1.5` (Jun 2 2026) DOES** — 43 langs incl uk, same $0.36/hr, **+ phrase/entity biasing (ideal for biblical names)**, AA-WER 2.4%. This is the single premium STT for all 3 langs. UK default = gpt-4o-mini-transcribe (lower multilingual WER than Whisper for +$0.069/hr). Phi-4 (no uk) + Deepgram Nova-3 (uk yes but now $0.46/hr + no public uk WER) demoted.

### TTS (speech: text→audio)
| Lang | Default | Premium |
|---|---|---|
| en | `x-ai/grok-voice-tts` **$15/M chars** | `google/gemini-3.1-flash-tts` (~$18 batch/$36 std per M) |
| ru | `x-ai/grok-voice-tts` $15/M (verify RU) | `google/gemini-3.1-flash-tts`; MAI-Voice-2 $22/M (ru `Lev`/`Masha`) |
| **uk** | **`google/gemini-3.1-flash-tts` ~$18/M batch** (uk official) | **`Respeecher ua-rt` $33/M** (uk-native, stress control) or ElevenLabs Multilingual-v2 |
- **CORRECTIONS:** Grok Voice = **$15/M (NOT $4.20)** and **does NOT officially support Ukrainian** (en/ru only). **`Gemini 3.5 Flash TTS` does not exist** (removed). Kokoro / Voxtral / MAI-Voice-1 & 2 — **no Ukrainian**. Ukrainian forces a different pick than en/ru (Gemini ~+21%, Respeecher ~+122%).

### ⚠️ MANDATORY real tests before final lock (today's evidence = support+cost+candidates, NOT a naturalness winner)
1. **UK transcription A/B** (30–60 min real sermons): Groq v3 vs gpt-4o-mini vs MAI-1.5 — total WER + biblical-name errors.
2. **UK TTS blind native-listen**: Gemini 3.1 vs Respeecher vs ElevenLabs vs Chirp-3-HD — naturalness/stress/long-form drift on 2–4 min sermon excerpts.
3. **Qwen UK warm-prose blind read** + JSON `response_format` test.
**Provider keys:** OpenRouter (text + Grok/Gemini TTS) · Groq (STT) · OpenAI (uk STT) · Microsoft Foundry (MAI-Transcribe-1.5 STT) · Respeecher/ElevenLabs (uk TTS premium) + keep current OpenAI/Google. Codex research journal: `.sessions/SESSION_2026-07-13-ukrainian-openrouter-model-research.md`.

---


Date: 2026-07-13. Complements `model-cost-writing-research-2026-02-28.md` (that one covered DIRECT providers; this adds OpenRouter). Prices = $ per 1M tokens unless noted; verified via web July 2026 (fresh — names/prices move fast, confirm on live model page before wiring).

## Why OpenRouter (owner's framing)
OpenAI/Google = "classic"; OpenRouter = "cheap classic" — one OpenAI-compatible API to hundreds of models, many at CENTS per million where the classics charge dollars. Ties back to the day-one goal: a cheap-but-good model for the free tier. OpenRouter passes provider prices through + ~5.5% fee on credit purchases only ([OR pricing](https://openrouter.ai/pricing)).

## TEXT — 4-model gradient (cheapest → best), all sub-dollar
| # | Model id (OpenRouter) | In $/M | Out $/M | Ctx | Quality signal | Fit (polish + outline, RU+EN, structured) |
|---|---|---|---|---|---|---|
| 1 cheapest | `deepseek/deepseek-v4-flash` | $0.09 | $0.18 | 1.05M | DeepSeek V4 MoE light tier; Pro sibling ~1450 Elo LMArena | Workhorse: bulk polish + first-pass outlines. 9¢/M = effectively free-grade, no throttle. |
| 2 multilingual | `google/gemini-3.1-flash-lite` | $0.25 | $1.50 | 1.05M | Google GA Flash-Lite, native structured/JSON, strong multilingual | Family continuity with our current Gemini; reliable plan/outline JSON. Watch $1.50 output. |
| 3 mid | `qwen/qwen3.7-plus` | $0.32 | $1.28 | 1M | Qwen3.7 Max sibling ~1450 Elo; top multilingual-for-RU family | Strong RU reasoning + instruction-following for structured outline. |
| 4 top | `deepseek/deepseek-v4-pro` | $0.435 | $0.87 | 1.05M | ~1450 Elo (Gemini 3.1 Pro / GPT-5.5 cluster); AA Intelligence Index 44 | Hardest outline/plan work, frontier-adjacent, still <$1/M. |

Sources: [OR DeepSeek](https://openrouter.ai/deepseek) · [OR Google](https://openrouter.ai/google) · [OR Qwen](https://openrouter.ai/qwen) · [LMArena text](https://arena.ai/leaderboard/text) · [Artificial Analysis](https://artificialanalysis.ai/models).

**"Cents vs dollars"** (owner's hypothesis — CONFIRMED): DeepSeek V4 Flash $0.09/M in vs Gemini 3.5 Flash $1.50/M in = ~16× cheaper input (~50× output). DeepSeek V4 Pro sits in the ~1450-Elo frontier cluster (Gemini 3.1 Pro / GPT-5.5 / Claude Opus) while pricing under $1/M.

### FINAL TEXT verdict — DEEP-RESEARCH 2026-07-13 (quality-per-$, overturns "cheapest wins")
Deep pass weighted QUALITY (esp. Russian warm prose) over raw cost. Result: the two cheapest are WEAKEST for warm RU prose → demoted to bulk/JSON roles; the sweet spot is one tier up.
- **⭐ DEFAULT warm rewrite (RU+EN) = `qwen/qwen3.7-plus`** ($0.32/$1.28). Highest intelligence of the affordable set (AA Index **39** vs Flash 29, Gemini-lite 25), writing-benchmark champion family (WritingBench / Creative-Writing-v3 top slots), IFBench leader (79.1), translation WMT24++ 85.8 / MAXIFE 89.2, Russian explicit, **no English-drift**. Sources: [AA compare](https://artificialanalysis.ai/models/comparisons/qwen3-7-plus-vs-deepseek-v4-flash-non-reasoning) · [Qwen blog](https://qwen.ai/blog?id=qwen3.7) · [SiliconFlow "best open LLM for Russian 2026"](https://www.siliconflow.com/articles/en/best-open-source-LLM-for-Russian) · [WritingBench](https://llm-stats.com/benchmarks/writingbench).
- **KEY CATCH:** DeepSeek V4 family **drifts to English on long Russian generations** (2 sources: [MindStudio](https://www.mindstudio.ai/blog/deepseek-v4-open-source-model-developers), [36kr](https://eu.36kr.com/en/p/3579563285969799)) → disqualifies Flash as the warm-RU default; keep it for cheap mechanical cleanup only.
- **Tier map:** free = `:free` model (dev/test only, rate-limited, weak RU) → tier1 `deepseek-v4-flash` ($0.09, bulk polish, +"keep original language" instruction) → tier2 `gemini-3.1-flash-lite` ($0.25, fast JSON scaffolding — NOT warm prose, intelligence 25) → **tier3 `qwen3.7-plus` ($0.32, DEFAULT warm rewrite ⭐)** → tier4 `deepseek-v4-pro` ($0.435/$0.87, hardest long-form, output cheaper than Qwen, but "respond in Russian only" guardrail).
- **Flags (verify before wiring):** Qwen $0.32/$1.28 is a **20%-off promo** (budget ~$0.40/$1.60); Qwen3.7 "preview" status (test stability); Qwen JSON `response_format` not explicitly listed (run one test); MERA (authoritative RU benchmark) could not be fetched (JS-rendered) → RU conclusions rest on translation/IF benchmarks + community, worth a manual look at mera.a-ai.ru.

**Free-tier `:free` on OpenRouter** (rate-limited 20 req/min, 200 req/day, can be throttled/deprecated): `openai/gpt-oss-120b:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `qwen/qwen3-coder:free`, `google/gemma-4-31b-it:free`, `meta-llama/llama-3.3-70b-instruct:free`. **Caveat:** `deepseek/*:free` NOT confirmed to exist. For reliability without throttle, `deepseek-v4-flash` ($0.09) is cheap enough to be the free-tier default.

## TRANSCRIPTION — go DIRECT, not via OpenRouter
**Correction to prior assumption:** OpenRouter DID launch STT (`/api/v1/audio/transcriptions`, OpenAI-compatible, May 1 2026 — [announcement](https://openrouter.ai/blog/announcements/announcing-audio-apis/)). BUT it bills per audio-token (nominal rates like "$40,000/M tokens" for Whisper Turbo) — hard to compare, generally worse value than direct. **Recommendation: transcription direct.** (And per the 2026-02-28 doc, transcription DOMINATES cost once text is cheap — so this is the biggest lever.)

| # | Option (direct) | $/min | $/hr | Quality (WER) | Source |
|---|---|---|---|---|---|
| 1 cheapest | Groq `whisper-large-v3-turbo` | ~$0.00067 | $0.04 | real-world ~8–12%; 228× realtime | [Groq](https://groq.com/pricing) |
| 2 best cheap | Groq `whisper-large-v3` | ~$0.00185 | $0.111 | full Whisper-v3 (best Whisper for RU) | [Groq](https://groq.com/pricing) |
| 3 better | OpenAI `gpt-4o-mini-transcribe` | $0.003 | $0.18 | lower WER than Whisper; drop-in for our OpenAI stack | [OpenAI](https://platform.openai.com/docs/pricing) |
| 4 top | Deepgram Nova-3 / OpenAI `gpt-4o-transcribe` | ~$0.0043 / $0.006 | ~$0.26 / $0.36 | Nova-3 5.8% WER; gpt-4o-transcribe 4.1% | [Deepgram](https://deepgram.com/pricing) · [WER](https://tokenmix.ai/blog/gpt-4o-transcribe-vs-whisper-review-2026) |

**Biggest economic lever:** Groq `whisper-large-v3-turbo` at $0.04/hr = ~9× cheaper than OpenAI whisper-1 ($0.36/hr) on the DOMINANT cost, same Whisper model.

### Microsoft / Azure STT (added per owner 2026-07-13)
| Option | $/hr | Notes | Source |
|---|---|---|---|
| Azure batch STT | $0.18–0.36 | competitive w/ OpenAI mini/gpt-4o, but 4.5–9× Groq turbo | [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/) · [review](https://blocksentient.com/review/microsoft-azure-speech-service/) |
| Azure real-time STT | $1.00 | $0.0167/min; expensive for our use | same |
| Azure Fast Transcription (short audio) | $0.66 | sync, ≤60s clips | same |
| Azure commitment tier | $0.50 | only at 50,000 hrs/mo — irrelevant at our scale | same |
| **Microsoft Phi-4-multimodal** (open) | hosting-dependent | **#1 HF OpenASR leaderboard, WER 6.14%, beats Whisper-v3** ([HF](https://huggingface.co/microsoft/Phi-4-multimodal-instruct), [ASR compare](https://www.scitepress.org/Papers/2026/146373/146373.pdf)) — open weights → cost = whoever hosts it (Azure Foundry / self-host / inference provider) | — |
| **MAI-Transcribe-1** (NEW MAI family, Apr 2 2026, Foundry) | **$0.36/hr** | top-25 langs; batch 2.5× faster than Azure Fast; powers Copilot/Bing ([Microsoft Foundry](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-mai-transcribe-1-mai-voice-1-and-mai-image-2-in-microsoft-foundry/4507787), [VentureBeat](https://venturebeat.com/technology/microsoft-launches-3-new-ai-models-in-direct-shot-at-openai-and-google)) | ↑ |

**Verdict on Microsoft STT:** does NOT change the cheap default. `MAI-Transcribe-1` ($0.36/hr) and Azure batch ($0.18–0.36) sit in the TOP-accuracy price tier (alongside Deepgram Nova-3 / gpt-4o-transcribe), NOT the cheap tier — all ~5–9× Groq turbo ($0.04). Phi-4-multimodal is accuracy-leader but hosting-dependent. Keep Groq turbo as cost default; MAI-Transcribe-1 / Deepgram Nova-3 as the premium-accuracy option (25 langs incl. RU is a plus for MAI).

## TEXT-TO-SPEECH (owner 2026-07-13: we voice sermons; add OpenRouter TTS alongside current OpenAI + Google)
OpenRouter offers TTS via `/api/v1/audio/speech` (OpenAI-compatible), priced per character/token of input ([OR TTS docs](https://openrouter.ai/docs/guides/overview/multimodal/tts), [OR TTS collection](https://openrouter.ai/collections/text-to-speech-models)). ⚠️ Higgins unit flag: sources mix "per 1M chars" and "per 1M tokens" — normalize per-1M-INPUT-CHARACTERS at wiring, do not compare raw.

| Tier | Model (OpenRouter unless noted) | Price | Notes | Source |
|---|---|---|---|---|
| cheapest | `Kokoro-82M` | ultra-cheap (tiny open model) | 8 langs, 54 preset voices | [OR TTS collection](https://openrouter.ai/collections/text-to-speech-models) |
| mid multilingual | `mistralai/voxtral-mini-tts` | ~$16/M in | zero-shot voice CLONING, multilingual | [OR Voxtral](https://openrouter.ai/mistralai/voxtral-mini-tts-2603) |
| mid | `google/gemini-3.1-flash-tts-preview` | $1 in / $20 out per 1M chars | 70+ languages (~3× predecessor) | [OR Gemini TTS](https://openrouter.ai/google/gemini-3.1-flash-tts-preview) |
| premium | `x-ai/grok-voice-tts-1.0` | ~$15/M in | 20+ langs, auto lang-detect, 5 voices | [OR Grok Voice](https://openrouter.ai/x-ai/grok-voice-tts-1.0) |
| premium (direct) | Microsoft **MAI-Voice-1** (Foundry) | $22/M chars | 60s audio in 1s, voice cloning, expressive | [Microsoft Foundry](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/introducing-mai-transcribe-1-mai-voice-1-and-mai-image-2-in-microsoft-foundry/4507787) |

**TTS verdict:** our current OpenAI + Google TTS stay. OpenRouter ADDS: `Kokoro-82M` (near-free TTS → great for free-tier voiceover), `voxtral-mini-tts` (cheap + voice cloning), and premium expressive voices (Grok / MAI-Voice-1) — all through the one OpenRouter key we'd already add for text. Gemini 3.1 Flash TTS is available both direct (we have it) and via OpenRouter.

## Recommendation (maps to tiers)
- **Free tier default:** `deepseek/deepseek-v4-flash` ($0.09/$0.18) — cheap-grade, no throttle (over `:free` models which are rate-limited).
- **Paid text gradient (tier1→tier4):** deepseek-v4-flash → gemini-3.1-flash-lite → qwen3.7-plus → deepseek-v4-pro. Spans ~5× input price, all in cents.
- **Transcription:** default Groq whisper-large-v3-turbo ($0.04/hr); quality upgrade gpt-4o-mini-transcribe / Deepgram Nova-3.

## Caveats (verify before wiring)
- Names/prices are July-2026 fresh but drift (Qwen3.7 vs 3.6, deepseek Pro $0.435 vs $0.46 in blogs) — confirm on the live OpenRouter model page.
- DeepSeek `:free` variant unconfirmed.
- OpenRouter STT per-audio-token → clean $/min not derivable; direct $/min above are the trustworthy numbers.
- RU-specific WER not broken out in sources; ranking (gpt-4o-transcribe / Nova-3 > Whisper) holds generally — validate on real RU sermon audio (blind test, per 2026-02-28 doc).
- Adding Groq/Deepgram = NEW direct providers (new keys), separate from the OpenRouter (OpenAI-compatible) text adapter.
