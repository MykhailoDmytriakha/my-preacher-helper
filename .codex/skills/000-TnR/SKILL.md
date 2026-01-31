---
name: 000-TnR-maximum
description: "[00] TnR MAXIMUM — Deep Think and Research Protocol. Manually invoked for critical investigations requiring full rigor. Executes complete research cycles, applies all mental models, builds comprehensive proof chains, and requires ≥95% calculated confidence before action. Always operates at maximum intensity — no shortcuts. Produces detailed uncertainty report if threshold not achieved."
---

# TnR MAXIMUM Protocol: Think and Research

> **Уверенность достигается через трудолюбие и действия.**  
> **Недостаточная уверенность — это лень.**

---

## Quick Reference (TL;DR)

| Element | Requirement |
|---------|-------------|
| **Mode** | Always MAXIMUM — no shortcuts |
| **Threshold** | ≥95% calculated confidence |
| **Models** | All 5 mental models applied |
| **Sources** | Internal exhausted → External verified |
| **Coverage** | Core + Boundary + Externalities |
| **Effects** | Up to 3rd order analyzed |
| **Output** | Action OR Uncertainty Report |

---

## Mandatory Checklist

Before declaring research complete, ALL items must be checked:

```
□ 1. INVERSION applied — failure modes enumerated
□ 2. FIRST PRINCIPLES applied — assumptions deconstructed  
□ 3. MULTI-ORDER EFFECTS — 3rd order analyzed
□ 4. CIRCLE OF COMPETENCE — limits acknowledged
□ 5. MAP ≠ TERRITORY — reality verified vs models
□ 6. Internal sources EXHAUSTED (code, git, docs, artifacts)
□ 7. External sources VERIFIED (web, official docs)
□ 8. Core domain 100% covered
□ 9. Boundary cases explored
□ 10. Externalities/side effects identified
□ 11. Proof chain for EVERY claim built
□ 12. Confidence CALCULATED (not estimated)
□ 13. ≥95% → action taken OR <95% → Uncertainty Report produced
□ 14. Session log entry written
```

---

## AGENTS.md Integration

This skill operates within the AGENTS.md protocol:

| AGENTS.md Section | TnR Integration |
|-------------------|-----------------|
| **§0 Identity** | TnR embodies truth-first, evidence-backed reasoning |
| **§2 Core Loop** | TnR executes during **Plan** and **Execute** phases |
| **§4 Session Artifacts** | TnR findings logged to JOURNAL.md, world model to SESSION.md |
| **§6 Evidence** | TnR proof chains provide required evidence |
| **§7 Evaluation** | TnR confidence maps to evaluation score |
| **§8 CRUD Safety** | TnR research precedes any K/NR operations |

**Dependencies:**
- Claims in SESSION.md backed by TnR proof chains
- JOURNAL.md receives TnR investigation timestamps
- MEMORY.md receives lessons from TnR cycles

---

## Activation Triggers

TnR MAXIMUM is **MANDATORY** when any of the following conditions are met:

### Explicit Invocation
```
User commands that activate TnR MAXIMUM:
├── /tnr, /think, /research, /investigate
├── "deep research", "full analysis", "investigate thoroughly"
├── "I need to understand why..."
└── "Before we proceed, make sure..."
```

### Automatic Triggers (agent must detect)

| Trigger | Example | Why MAXIMUM |
|---------|---------|-------------|
| **K/NR CRUD operations** | Database migration, file deletion | Irreversible actions require proof |
| **Production systems** | Deploying to prod, modifying live config | High blast radius |
| **Solution confidence < 70%** | "I think this might work..." | AI reasoning insufficient |
| **Multiple valid approaches** | 3+ ways to solve problem | Need evidence to choose |
| **External system integration** | Third-party API, new library | Unknown behavior |
| **Contradictory evidence** | Docs say X, code does Y | Must resolve before action |
| **Security-related changes** | Auth, permissions, secrets | Zero tolerance for guessing |

---

## Core Philosophy

### The Iron Logic Standard

```
CLAIM → EVIDENCE → SOURCE → VERIFICATION → CONFIDENCE
```

**Rules:**
- Each link: **observable**, **testable**, or **logically necessary**
- Broken link = incomplete research = MORE WORK NEEDED
- NO action on unverified assumptions
- Opinions and "it seems" are NOT evidence

### The 150% Rule

| Dimension | 100% Core | +50% Enhancement |
|-----------|-----------|------------------|
| **Evidence** | Verifiable facts | + Cross-validated from multiple sources |
| **Analysis** | 2nd-order effects | + 3rd-order effects considered |
| **Coverage** | Core domain | + Boundaries + externalities mapped |
| **Confidence** | State uncertainty | + Detailed reasoning chain documented |

---

## Mental Models (ALL MANDATORY)

### 1. Inversion Thinking
> "What would make this fail?"

```
Goal: [Your objective]
Inversion: What would make it fail?
├── [Failure mode 1]
├── [Failure mode 2]
├── [Failure mode 3]
└── [Failure mode N]

→ Address each failure mode explicitly
```

### 2. Circle of Competence
> Know your limits. Acknowledge uncertainty.

```
INSIDE CIRCLE (proceed with confidence):
├── Direct experience with this codebase
├── Verified understanding of the problem
└── Evidence-backed knowledge

OUTSIDE CIRCLE (research first, proceed with caution):
├── New domain / unfamiliar technology
├── Assumptions without verification
└── "I think" without "because I verified"
```

### 3. First Principles Reasoning
> Deconstruct to fundamental truths.

```
Step 1: What do I assume to be true?
Step 2: Why? What's the evidence?
Step 3: Strip assumptions. What remains?
Step 4: Build solution from fundamental truths only
```

### 4. Multi-Order Effects Analysis

| Order | Question | Must Answer |
|-------|----------|-------------|
| **1st** | Direct result? | Always |
| **2nd** | What results from that? | Always |
| **3rd** | What results from *that*? | Always (MAXIMUM mode) |

**Rule:** Never stop at first-order. Always ask "and then what?" twice more.

### 5. Map ≠ Territory
> Models are simplifications. Reality is truth.

```
WARNING SIGNS:
├── "According to the docs..." (but did you test it?)
├── "Usually this means..." (but is this case usual?)
└── "The pattern suggests..." (but does reality confirm?)

ANTIDOTE:
→ Read the actual code
→ Run the actual test
→ Check the actual behavior
```

---

## Research Protocol

### The Research Loop

```
┌────────────────────────────────────────┐
│           RESEARCH LOOP                │
├────────────────────────────────────────┤
│  START: Question / Task                │
│     ↓                                  │
│  COLLECT: Gather from ALL sources      │
│     ↓                                  │
│  ASSESS: What's KNOWN? What's MISSING? │
│     ↓                                  │
│  Gaps found?                           │
│     ↓ YES              ↓ NO            │
│  SEARCH for         Chain complete     │
│  missing pieces     Calculate conf.    │
│     ↓               ≥95%? → PROCEED    │
│  VALIDATE: Is       <95%? → REPORT     │
│  new info reliable?                    │
│     ↓                                  │
│  Return to ASSESS ←────────────────────│
└────────────────────────────────────────┘
```

### Source Priority (MANDATORY ORDER)

```
1. INTERNAL FIRST → Project-specific truth (highest priority)
   ├── Source code (grep_search, view_file)
   ├── Git history (git log, git blame, git show)
   ├── Project artifacts (AGENTS.md, MEMORY.md, SESSION.md)
   ├── Configuration files (package.json, tsconfig, etc.)
   └── Test results, build outputs

2. OFFICIAL DOCS → Authoritative source
   ├── Documentation sites (MDN, official docs)
   ├── API references
   └── GitHub repos (issues, PRs, discussions)

3. WEB SEARCH → Broader context
   └── search_web, read_url_content

4. COMMUNITY → Practical experience (validate carefully)
   ├── Stack Overflow
   ├── Forums, Reddit
   └── Blog posts, tutorials

5. AI REASONING → Lowest priority (ALWAYS validate)
```

### Two Worlds Model

Most questions require research from BOTH worlds:

```
🏠 INTERNAL (Project Context)        🌍 EXTERNAL (World Knowledge)
├── Source code (ground truth)       ├── Official documentation
├── Git history (why & when)         ├── Web search (patterns)
├── Tests (expected behavior)        ├── Stack Overflow / forums
├── Logs (actual behavior)           ├── GitHub issues
└── Config files                     └── Best practice guides
```

| World | Answers | Use When |
|-------|---------|----------|
| **Internal** | "What we have", "Why it exists" | Bug investigation, code understanding |
| **External** | "What's possible", "Best practices" | Library choice, architecture decisions |
| **Both** | Complete picture | Most serious investigations |

**Rule:** Don't stay in one world. Internal tells you "what is", External tells you "what could be".

### Project Search Protocol

When navigating unfamiliar code, follow this order:

```
1. INTERFACE → routes, endpoints, public methods, schemas
      ↓
2. DOMAIN → model/entity names, enums, types
      ↓
3. PATTERNS → hooks, API clients, controllers, services
      ↓
4. USAGE → imports, call sites, references
```

**Anti-pattern:** Jumping directly to implementation without understanding context → structure → interface.

**Systematic Exploration (unknown codebases):**
1. **Context layer** — environment, build system, configuration
2. **Structure layer** — directory layout, module boundaries
3. **Interface layer** — endpoints, public APIs, data models
4. **Implementation layer** — execution paths and conventions

### Evidence Hierarchy

| Rank | Source | Weight | Notes |
|------|--------|--------|-------|
| 1 | Production code | 1.00 | Reality, ground truth |
| 2 | Passing tests | 0.95 | Verified behavior |
| 3 | Official documentation | 0.85 | Intended behavior |
| 4 | Community sources | 0.60 | May be outdated |
| 5 | AI reasoning | 0.30 | ALWAYS needs validation |

---

## Domain Coverage (THREE ZONES)

```
┌─────────────────────────────────────────┐
│  ┌───────────────────────────────────┐  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │      CORE DOMAIN            │  │  │
│  │  │    (100% coverage)          │  │  │
│  │  └─────────────────────────────┘  │  │
│  │         BOUNDARY                   │  │
│  │       (explore edges)              │  │
│  └───────────────────────────────────┘  │
│           EXTERNALITIES                  │
│        (side effects zone)               │
└─────────────────────────────────────────┘
```

| Zone | Requirement |
|------|-------------|
| **Core** | 100% coverage MANDATORY |
| **Boundary** | Explore for hidden factors |
| **Externalities** | Identify upstream/downstream effects |

---

## Confidence Calculation

### Base Formula

```
Base_Confidence = Σ(claim × source_weight) / total_claims × 100%

Where source_weight from Evidence Hierarchy:
├── Production code: 1.00
├── Passing tests: 0.95
├── Official docs: 0.85
├── Community: 0.60
└── AI reasoning: 0.30
```

### Critical Path Penalties

**Critical Claims** = claims in the execution path where failure causes:
- Data loss or corruption
- Security breach
- Production outage
- Irreversible state change

```
Penalty Calculation:
├── Each UNVERIFIED critical claim:     -10%
├── Each AI-ONLY claim in critical path: -15%
├── Missing CORE zone coverage:          -20%
├── No cross-validation for key claims:  -5%
└── Contradictory evidence unresolved:   -25%

Final_Confidence = Base_Confidence - Total_Penalties
```

### Critical Claim Requirements

| Claim Type | Minimum Source Weight | Verification Required |
|------------|----------------------|----------------------|
| Critical (failure = disaster) | ≥ 0.95 | Code OR passing test |
| Important (failure = significant work) | ≥ 0.85 | Official docs acceptable |
| Standard (failure = minor rework) | ≥ 0.60 | Community sources OK |

### Example Calculation (v2)

```
Task: Migrate user database schema

Claims analysis:
├── Claim 1: Migration script syntax correct
│   └── Source: code review → 1.00 | CRITICAL ✓
├── Claim 2: Rollback procedure works  
│   └── Source: tested locally → 0.95 | CRITICAL ✓
├── Claim 3: No data loss during migration
│   └── Source: AI reasoning only → 0.30 | CRITICAL ✗ PENALTY
├── Claim 4: Downtime < 5 minutes
│   └── Source: official docs → 0.85 | IMPORTANT ✓
├── Claim 5: Indexes rebuilt automatically
│   └── Source: Stack Overflow → 0.60 | STANDARD ✓

Base_Confidence = (1.00 + 0.95 + 0.30 + 0.85 + 0.60) / 5 = 74%

Penalties:
├── Claim 3: AI-only in critical path → -15%
└── Total Penalties: -15%

Final_Confidence = 74% - 15% = 59%

Verdict: CANNOT PROCEED → Must verify Claim 3 with test or code
```

### The Standard

| Confidence | Action |
|------------|--------|
| **≥95%** | **PROCEED** — Full proof chain built |
| **80-94%** | **PROCEED WITH CAUTION** — Document gaps, prepare rollback |
| **<80%** | **PRODUCE UNCERTAINTY REPORT** — Cannot proceed |

### Achieving 95%

```
REQUIREMENTS for ≥95%:
├── ALL critical claims verified by weight ≥ 0.95 sources
├── NO AI-only claims in critical path
├── Core domain 100% covered
├── At least 2 sources cross-validate key claims
├── All contradictions resolved
├── Failure modes explicitly addressed
└── Rollback plan verified (for K/NR operations)
```

---

## Uncertainty Report (MANDATORY when <95%)

```markdown
⚠️ **UNCERTAINTY REPORT**

**Calculated Confidence:** [X]%

**Proof Chain Summary:**
| # | Claim | Source | Weight | Verified |
|---|-------|--------|--------|----------|
| 1 | [claim] | [source] | [weight] | ✓/✗ |

**Gaps Found:**
- [Gap 1]: [why unresolved]
- [Gap 2]: [why unresolved]

**Research Exhausted:**
- Internal: [files, git, artifacts checked]
- External: [searches, docs consulted]

**What IS Known (high confidence):**
- [Confirmed fact 1]
- [Confirmed fact 2]

**Resolution Options:**
- Option A: [additional research direction]
- Option B: [user could provide X]
- Option C: [accept with stated assumptions]

**Recommended Next Step:** [recommendation]
```

---

## Quality Gates (ALL MANDATORY)

| Phase | Gate Questions |
|-------|----------------|
| **Goal** | Clear success criteria defined? "Done" looks like what? |
| **Research** | Proof chain complete? All 5 models applied? Sources cross-validated? |
| **Analysis** | All alternatives considered? Risks identified? 3rd-order effects mapped? |
| **Plan** | Steps atomic and actionable? Rollback possible? |
| **Execute** | Tests pass? Lint clean? No regressions? CRUD safety classified? |
| **Close** | Lessons captured? Proof chain documented? Session artifacts updated? |

### Final Check (MUST answer YES to all)

```
□ Can I trace every claim to verifiable evidence?
□ Have I applied all 5 mental models?
□ Have I considered 3rd-order effects?
□ Am I inside my circle of competence (or flagged otherwise)?
□ Is my confidence ≥95% calculated (not estimated)?
□ If <95%, have I produced complete Uncertainty Report?
□ Have I updated session artifacts (`.sessions/SESSION_[date]-[name].md`)?
```

### Cognitive Forcing Phrases

Use these self-check statements during research to force rigor:

```
"I see X, but I will verify with 3 independent sources."
"This suggests Y, but what would disprove Y?"
"Found 1 example, need 2 more to confirm pattern."
"Seems obvious, but can I prove causality?"
"Based on assumptions — STOP, find evidence."
```

**Red Flags (investigation incomplete):**
- "probably / likely / should / usually" without verification
- "based on the name" or "seems like"
- Only one usage checked
- No contradiction search performed

---

## Failure Modes & Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| **Shallow research** | Sources unchecked | Return to Research Loop, exhaust all source types |
| **Confirmation bias** | Only supporting evidence | Apply Inversion, seek disconfirming evidence |
| **Stopped early** | Only 1st-order effects | Apply Multi-Order to 3rd order |
| **False confidence** | ≥95% without calculation | Recalculate using formula with weights |
| **Scope blindness** | Externalities missed | Apply Domain Coverage, check all 3 zones |
| **Circular reasoning** | Evidence → assumption | Apply First Principles, deconstruct to axioms |

---

## Example: TnR MAXIMUM in Action

### ❌ Without TnR

```
User: "Why is this API call slow?"
AI: "Probably the database. Adding index."
Result: Root cause was network latency. Wasted effort, added debt.
```

### ✅ With TnR MAXIMUM

```
User: "Why is this API call slow?"

🔬 TnR MAXIMUM ACTIVATED

**Mental Models Applied:**

[1] INVERSION — What causes API slowness?
├── Database query time
├── Network latency  
├── Serialization overhead
├── Cold start / connection pool
├── Upstream service delays
└── Heavy computation

[2] FIRST PRINCIPLES — What do we actually know?
├── Assumption: "Database is slow" — UNVERIFIED
└── Must measure, not assume

**Research Loop:**

COLLECT (Internal — exhausted):
├── grep_search: handler code
├── view_file: database query  
├── git log: recent changes
└── run_command: logs with timing

FINDINGS:
├── Query: 12ms ✓
├── Handler: 5ms ✓
├── Total: 3.2s ✗
└── GAP: Where is 3.1s?

SEARCH (fill gap):
├── Network timing in logs
├── Found: external API call = 2.9s
└── Verified: third_party_api.call() is bottleneck

**Proof Chain:**
| # | Claim | Source | Weight |
|---|-------|--------|--------|
| 1 | DB fast (12ms) | Production logs | 1.00 |
| 2 | Handler fast (5ms) | Profiler | 0.95 |
| 3 | 3rd party slow (2.9s) | Logs + timing | 1.00 |
| 4 | Not network issue | ping/traceroute | 0.95 |

Confidence = (1.00 + 0.95 + 1.00 + 0.95) / 4 = 97.5%

**Multi-Order Effects:**
├── 1st: Add cache → faster response
├── 2nd: Cache → stale data risk
└── 3rd: Stale data → invalidation needed

**Domain Coverage:**
├── Core: API endpoint ✓
├── Boundary: DB, network ✓  
└── Externalities: rate limits ✓

**Conclusion (97.5% confidence):**
Root cause: third-party API latency (2.9s avg)

**Solutions:**
1. Cache with TTL (handles staleness)
2. Async pattern (return immediately)
3. Negotiate faster endpoint

Proceed with solution 1?
```

---

## Session Log Entry (MANDATORY)

After TnR MAXIMUM, append to `.sessions/SESSION_[date]-[name].md`:

```
### [HH:MM] TnR MAXIMUM Applied
**Question:** <what was investigated>
**Models Applied:** Inversion ✓ | FirstPrinciples ✓ | MultiOrder ✓ | Competence ✓ | Map≠Territory ✓
**Key Findings:** <main discoveries>
**Proof Chain:** <claims count> claims, <confidence>% calculated
**Gaps:** <remaining gaps or "none">
**Decision:** <action taken or uncertainty report produced>
```

---

## Operational Rules

1. **MAXIMUM ALWAYS** — This skill has no shortcuts or light modes
2. **ALL MODELS** — Every mental model must be applied
3. **CALCULATED CONFIDENCE** — Use formula, not estimation
4. **95% THRESHOLD** — Below this = mandatory Uncertainty Report
5. **INTERNAL FIRST** — Project sources before external
6. **PROOF CHAINS** — Every claim traceable to evidence
7. **3RD ORDER** — Never stop at 1st or 2nd order effects
8. **SESSION INTEGRATION** — Update `.sessions/SESSION_[date]-[name].md` every time
9. **ACKNOWLEDGE LIMITS** — Flag when outside competence

---

**Remember:** TnR MAXIMUM is invoked when rigor matters. Every shortcut is a potential error. The proof chain protects from mistakes. The research loop ensures completeness. The 95% threshold ensures action on solid ground.

**Уверенность = трудолюбие. Неуверенность = лень.**
