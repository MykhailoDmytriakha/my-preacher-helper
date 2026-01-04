---
name: research-150
description: Deep research workflow for this project using 150% scope (100% core + 50% boundary), evidence-based reasoning, and structured investigation notes. Use when the task requires investigation, root-cause analysis, or mapping unknown areas. Always maintain a research log file that captures findings, hypotheses, and next branches; use web.run when external verification is needed.
---

# Research 150

## Goal

Perform deep, evidence-based research by mapping both core scope (100%) and boundary scope (50%), while maintaining a structured investigation log that captures what was found and what to explore next.

## Core principles

- **Evidence-based reasoning:** Observe → Hypothesize → Predict → Test → Conclude.
- **Scope150:** Fully cover the core (what is directly asked) and then cover boundary (adjacent or dependent areas).
- **Traceability:** Every key finding is recorded in a research log.

## Research log (mandatory)

Create or reuse a file named:

`.temp/INVESTIGATION.md`

If `.temp/` does not exist, create it. This file is the working memory for the investigation.

### Log structure (use nested bullets)

```
# Investigation Log: <short topic>

## Core question
- <what we are trying to answer>

## Scope
- Core (100%):
  - ...
- Boundary (50%):
  - ...

## Findings
- <fact> (source: file path / command / web)
  - Subfinding

## Hypotheses
- H1: ...
  - Prediction: ...
  - Test: ...
  - Status: pending/confirmed/rejected

## Next branches
- ...
  - ...
```

## Workflow

1. **Define core question** in the log.
2. **List scope**: core (100%) and boundary (50%).
3. **Start observations** (search/read/run commands). Record every solid finding in the log.
4. **Form hypotheses** based on evidence; record predictions and tests.
5. **Review log**, then decide next branch; update scope if it expands.
6. **Repeat** until the question is answered or all branches are exhausted.
7. **Summarize**: write a concise summary in the log and in the response.

## Using web search

- If the investigation needs up-to-date facts or external verification, use `web.run` or `web search` tool.
- Capture external findings in the log with a clear source note.

## Output expectations

- Provide a short summary of findings.
- Provide the path to the investigation log file.
- Ask for confirmation before large changes based on the research.
