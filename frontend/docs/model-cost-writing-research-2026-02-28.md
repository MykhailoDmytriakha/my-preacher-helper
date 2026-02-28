# Model Cost & Writing Research

Date: 2026-02-28

## Executive Verdict

If the goal is "теплый, легкий, живой текст" at scale, the cheapest sustainable path is not "pick one miracle model". The winning pattern is:

1. Keep audio transcription separate.
2. Use a cheap model for cleanup / tagging / simple rewrites.
3. Use a better writer only as fallback for the cases where the cheap path is too dry.
4. Exploit prompt caching and reduce prompt overhead.

For this project, the strongest practical options are:

- **Best low-cost default for text rewrite**: `Mistral Small Creative` or `Mistral Small` class.
- **Best easiest low-risk switch inside current architecture**: `Gemini 2.5 Flash-Lite` for `polishTranscription` and tag-like tasks, with selective use for `thought`.
- **Best OpenAI budget option**: `GPT-5 nano` for cheap default, `GPT-5 mini` as quality fallback.
- **Best premium fallback for "heartfelt" prose**: `GPT-5 mini` first, optionally `Claude Sonnet/Haiku` only for premium mode.

The main architectural conclusion is more important than the model list:

> Once rewrite cost is pushed down into the `~$0.0004-$0.0006` range per note, **transcription becomes the dominant cost** for voice capture flows.

That means the biggest savings will come from routing and prompt optimization, not only from changing provider.

---

## What The Codebase Is Doing Now

Internal facts verified from the repo:

- Current `.env.local` uses:
  - `OPENAI_AUDIO_MODEL=gpt-4o-transcribe`
  - `OPENAI_GPT_MODEL=o4-mini`
  - `OPENAI_OPTIMIZATION_MODEL=o4-mini`
  - `GEMINI_MODEL=gemini-2.5-flash-lite`
  - `AI_MODEL_TO_USE=OPENAI`
- Main text-related flows:
  - `thoughts/route.ts`: transcription -> `generateThoughtStructured()`
  - `thoughts/transcribe/route.ts`: transcription -> `polishTranscription()`
  - `studies/transcribe/route.ts`: transcription -> `polishTranscription()`
- Most structured text calls go through `callWithStructuredOutput()`, which already records token usage and latency into telemetry.

### Internal telemetry findings

Verified from Firestore telemetry on 2026-02-28:

| Prompt | Count | Avg Prompt Tokens | Avg Completion Tokens | Avg Total Tokens | Avg Latency |
|---|---:|---:|---:|---:|---:|
| `thought@v3` | 10 | 2,066 | 838 | 2,905 | 7.9s |
| `polishTranscription@v2` | 3 | 642 | 505 | 1,146 | 4.6s |
| `thought@v1` | 51 | 3,909 | 845 | 4,754 | 6.3s |

Important internal conclusion:

- `thought@v3` already reduced average total tokens by **38.9%** vs `thought@v1`.
- The reduction came mainly from prompt shrinkage: **-47.1% prompt tokens**.
- This proves that prompt design is already a first-class cost lever in this product.

### Gemini vs o4-mini in your own telemetry

For `thought@v1`:

- `gemini-2.5-flash-lite`: 3,640 total tokens, 1.4s avg latency
- `o4-mini`: 5,533 total tokens, 9.8s avg latency

Observed difference:

- Gemini used **34.2% fewer total tokens**
- Gemini used **82.4% fewer completion tokens**
- Gemini was **85.7% faster**

Interpretation:

- Cheap fast models are already viable in your codebase.
- But they also produce much shorter completions, so some of the savings likely come from less-developed prose, not only cheaper pricing.

That is why the right pattern is **cheap default + quality fallback**, not "force cheapest model on every note".

### Prompt overhead is real

Measured static prompt sizes in the repo:

- `thoughtSystemPrompt`: 5,153 characters
- `polishTranscription.structured.ts`: 7,211 characters
- `speechOptimization.client.ts`: 7,245 characters

And `createThoughtUserMessage()` is already capped to:

- max `5` example thoughts
- max `300` chars per example

So the dominant waste now is not uncontrolled history explosion; it is the repeated fixed instruction layer.

---

## Market Research: Models Worth Considering

### 1. OpenAI

Official pricing highlights:

- `GPT-5 nano`: `$0.05 / 1M` input, `$0.40 / 1M` output, cached input `$0.005 / 1M`
- `GPT-5 mini`: `$0.25 / 1M` input, `$2.00 / 1M` output, cached input `$0.025 / 1M`
- Batch API: 50% discount on inputs and outputs
- Prompt caching: automatic on prompts longer than 1,024 tokens
- `gpt-4o-transcribe`: about `$0.006 / minute`
- `whisper-1`: `$0.006 / minute`

Fit for this project:

- **`GPT-5 nano`**: strongest "stay on OpenAI and get much cheaper" candidate.
- **`GPT-5 mini`**: safer quality fallback when the text must sound richer and more human.
- If you stay with OpenAI, moving rewrite work away from reasoning-oriented `o4-mini` class and into `nano/mini` class is the most obvious economic win.

Confidence:

- Pricing: **95%**
- Rewrite fit inference: **82%**

### 2. Google

Official pricing highlights:

- `Gemini 2.5 Flash-Lite`: `$0.10 / 1M` input, `$0.40 / 1M` output
- `Gemini 2.5 Flash`: `$0.30 / 1M` input, `$2.50 / 1M` output
- Batch mode halves price
- Google positions `Flash-Lite` for cost efficiency and low latency

Fit for this project:

- **Excellent for cleanup, tagging, normalization, and short rewrite**
- **Plausible default for low-cost rewrite**, especially since it already works in your telemetry
- But based on your own telemetry, it tends to answer more briefly than `o4-mini`, so it may need stronger style prompting if used for "text that lands in the heart"

Confidence:

- Pricing: **95%**
- Rewrite fit inference: **84%**

### 3. Anthropic

Official pricing highlights:

- `Claude 3.5 Haiku`: `$0.80 / 1M` input, `$4.00 / 1M` output
- Batch processing: 50% discount
- Prompt caching:
  - 5-minute write: 1.25x base input
  - 1-hour write: 2x base input
  - cache hits: 0.1x base input

Fit for this project:

- Anthropic is still strong when prose quality matters.
- But for this product, `Haiku` is already materially more expensive than `nano/flash-lite/small`.
- Good premium fallback, bad default budget choice.

Confidence:

- Pricing: **95%**
- Rewrite fit inference: **80%**

### 4. Mistral

Official pricing highlights:

- `mistral-small-latest`: `$0.10 / 1M` input, `$0.30 / 1M` output
- `ministral-8b-latest`: `$0.10 / 1M` input, `$0.10 / 1M` output
- `Mistral Small Creative` is documented as suitable for long-form generation, creative writing, and conversational AI at the same price class as `mistral-small-latest`

Fit for this project:

- **This is the most interesting budget candidate for "heartfelt rewrite"**
- Why: Mistral explicitly positions the `Small Creative` line for creative writing, while keeping pricing close to the cheapest serious API tiers
- `ministral-8b` looks attractive for tagging, classification, or cleanup, but is a riskier default for nuanced sermon prose

Confidence:

- Pricing: **93%**
- Rewrite fit inference: **88%**

### 5. DeepSeek

Official pricing highlights:

- `DeepSeek-V3.1`: `$0.56 / 1M` input (cache miss), `$0.14 / 1M` input (cache hit), `$1.68 / 1M` output

Fit for this project:

- Good cheap generalist relative to frontier models
- Not obviously the best fit for your specific "warm pastoral rewrite" task
- More interesting as a strong low-cost general fallback than as the core writing model

Confidence:

- Pricing: **90%**
- Rewrite fit inference: **72%**

---

## Cost Simulation Using Your Real Telemetry

Assumption:

- Use your measured `thought@v3` average:
  - input: `2,059` tokens
  - output: `879` tokens
- One voice note also includes one minute of transcription at `$0.006 / minute`

Estimated rewrite-only cost per note:

| Model | Estimated Rewrite Cost / Note |
|---|---:|
| `GPT-5 nano` | `$0.000455` |
| `Mistral Small / Small Creative` | `$0.000470` |
| `Gemini 2.5 Flash-Lite` | `$0.000558` |
| `GPT-5 mini` | `$0.002273` |
| `DeepSeek-V3.1` | `$0.002630` |
| `Claude 3.5 Haiku` | `$0.005163` |

### Scenario: 1,000 users, 10 one-minute voice notes each

That is `10,000` notes and `10,000` transcription minutes.

| Stack | Rewrite Cost | Transcription Cost | Total |
|---|---:|---:|---:|
| `GPT-5 nano` + transcription | `$4.55` | `$60.00` | `$64.55` |
| `Mistral Small Creative` + transcription | `$4.70` | `$60.00` | `$64.70` |
| `Gemini 2.5 Flash-Lite` + transcription | `$5.58` | `$60.00` | `$65.58` |
| `GPT-5 mini` + transcription | `$22.73` | `$60.00` | `$82.73` |
| `Claude 3.5 Haiku` + transcription | `$51.63` | `$60.00` | `$111.63` |

Main conclusion:

- Once rewrite is on a budget model, **transcription dominates**.
- Therefore, if the fear is "1,000 users will destroy cost", the main risk is not text rewrite alone.
- The dangerous pattern is using a stronger-than-needed model for every rewrite, every polish, every tag, and every premium flow by default.

Confidence in the scenario:

- Internal token assumptions: **95%**
- Provider pricing: **90-95%** depending on provider
- Product behavior assumption: **78%** because real user note length may differ

---

## What The Industry Is Already Doing In This Direction

Yes, people are already moving hard in this direction.

### 1. Routing / cascading

Research and production systems increasingly use:

- cheap model first
- stronger model only on hard cases

Why it matters here:

- your task has many "easy" notes: filler removal, punctuation fixes, obvious structure cleanup
- only some notes need truly strong prose generation

This matches the `SATOR` routing paper: route each prompt to the cheapest model that still meets quality threshold.

### 2. Prompt caching

This project is an ideal caching candidate because:

- large repeated system prompts
- repeated task shapes
- same instruction prefix across many requests

OpenAI and Anthropic both explicitly support prompt caching; Google and DeepSeek also expose caching-oriented pricing concepts.

### 3. Batch for non-interactive work

Batch is relevant for:

- backfilling old notes
- re-running tag cleanup
- nightly study-note normalization
- analytics / quality review pipelines

Batch is **not** a solution for live typing/recording UX, but it is a very real lever for offline workloads.

### 4. Distillation / fine-tune on your accepted edits

The market is also moving toward:

- collect accepted outputs
- learn the house style
- distill stronger outputs into smaller cheaper models

This is especially relevant for your app because "ложится в сердце" is partly a **style distribution**, not just raw intelligence.

If you gather a corpus of:

- original transcript
- accepted rewritten note
- language
- sermon context

then over time you can teach a cheaper model your exact pastoral style.

---

## Product-Specific Recommendation

### Recommended target architecture

#### Tier A: cheapest always-on path

Use for:

- transcription polish
- tag suggestion
- study-note cleanup
- short rewrite of simple notes

Candidates:

- `Gemini 2.5 Flash-Lite`
- `GPT-5 nano`
- `ministral-8b` for classification-only substeps

#### Tier B: default rewrite path

Use for:

- turning spoken sermon dictation into written prose
- preserving warmth and readable flow

Candidates:

- `Mistral Small Creative`
- `GPT-5 mini`

My current preference:

- **If you want the cheapest "good writer"**: try `Mistral Small Creative`
- **If you want lowest integration risk**: try `GPT-5 mini` fallback behind `GPT-5 nano`

#### Tier C: premium fallback only

Trigger only when:

- cheap model output is too short
- faithfulness score is low
- warmth/readability judge is low
- user manually taps "Improve deeper"

Candidates:

- `GPT-5 mini`
- `Claude Sonnet/Haiku`

### Best immediate move for this repository

Low-risk order:

1. Keep transcription separate.
2. Route `polishTranscription` to `gemini-2.5-flash-lite` or `GPT-5 nano`.
3. Stop using reasoning-class model as the default rewrite engine.
4. Test `thought` on:
   - `Gemini 2.5 Flash-Lite`
   - `GPT-5 nano`
   - `Mistral Small Creative`
   - `GPT-5 mini`
5. Add a cheap judge:
   - faithfulness preserved?
   - did it stay in correct language?
   - is output too short?
   - did it keep biblical references disciplined?
6. Escalate only failed cases to the premium writer.

---

## Blind Test Plan Before You Commit

Do not choose the final model from brand reputation alone.

Run a real blind test on `30-50` authentic notes across Russian/Ukrainian/English.

Score each output on:

1. Faithfulness to the speaker's meaning
2. Warmth / humanity / "lands in the heart"
3. Clarity and flow
4. Over-editing risk
5. Biblical reference discipline
6. Need for manual touch-up

Recommended shortlist for that blind test:

- `Gemini 2.5 Flash-Lite`
- `GPT-5 nano`
- `Mistral Small Creative`
- `GPT-5 mini`

If one model wins clearly on warmth while staying within 2-3x of the cheapest, that is usually the correct default business choice.

---

## Final Recommendation

If I had to choose the strategy today:

### Conservative choice

- `polish / cleanup / tags`: `Gemini 2.5 Flash-Lite`
- `default rewrite`: `GPT-5 nano`
- `fallback rewrite`: `GPT-5 mini`

Why:

- minimum implementation risk
- keeps most of the stack in providers you already use
- gives an immediate path away from expensive over-capable reasoning usage

### More aggressive cost-quality choice

- `polish / cleanup / tags`: `Gemini 2.5 Flash-Lite`
- `default rewrite`: `Mistral Small Creative`
- `fallback rewrite`: `GPT-5 mini`

Why:

- strongest chance of getting cheaper prose that still feels human
- explicitly aligned with creative writing rather than raw reasoning

### What I would avoid

- using a reasoning-oriented model as the default rewrite engine
- paying premium model prices for cleanup/tagging
- deciding from benchmarks alone without blind evaluation on your real sermon notes

---

## Sources

Official pricing and docs:

- OpenAI pricing: [https://openai.com/api/pricing/](https://openai.com/api/pricing/)
- OpenAI speech-to-text pricing: [https://platform.openai.com/docs/pricing#speech-to-text](https://platform.openai.com/docs/pricing#speech-to-text)
- OpenAI prompt caching: [https://platform.openai.com/docs/guides/prompt-caching](https://platform.openai.com/docs/guides/prompt-caching)
- OpenAI Batch API: [https://platform.openai.com/docs/guides/batch](https://platform.openai.com/docs/guides/batch)
- Google Gemini pricing: [https://ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)
- Anthropic pricing: [https://docs.anthropic.com/en/docs/about-claude/pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- Anthropic prompt caching: [https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- Anthropic batch processing: [https://docs.anthropic.com/en/api/messages-batch-examples](https://docs.anthropic.com/en/api/messages-batch-examples)
- Mistral pricing: [https://docs.mistral.ai/getting-started/models/models_overview/](https://docs.mistral.ai/getting-started/models/models_overview/)
- Mistral Small Creative: [https://docs.mistral.ai/capabilities/completion/usage](https://docs.mistral.ai/capabilities/completion/usage)
- DeepSeek pricing: [https://api-docs.deepseek.com/quick_start/pricing/](https://api-docs.deepseek.com/quick_start/pricing/)

Research / systems direction:

- SATOR routing paper: [https://arxiv.org/abs/2503.13288](https://arxiv.org/abs/2503.13288)
- Distilling Step-by-Step: [https://arxiv.org/abs/2305.02301](https://arxiv.org/abs/2305.02301)
- WritingBench: [https://arxiv.org/abs/2504.11178](https://arxiv.org/abs/2504.11178)
- LongWriter: [https://arxiv.org/abs/2408.07055](https://arxiv.org/abs/2408.07055)
