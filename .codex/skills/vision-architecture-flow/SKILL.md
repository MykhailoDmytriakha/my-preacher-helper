---
name: vision-architecture-flow
description: Structure messy, high-leverage work before implementation by freezing Vision, Sync With User, IFR, Reality Map, Contradictions, Resolution Principles, Options/Best Path, System Structure, Operational Model, Implementation Criteria, Prototype/Pilot, Implementation, Testing + Verification, and Iteration/Rollout. Use when the user has an unclear or sprawling problem, when architecture must be defined before coding, when multiple paths exist, or when the system risks premature implementation. Always track this structure inside the active `.sessions/SESSION_[date]-[name].md` file as the audit trail of how system-changing decisions were made.
---

# Vision Architecture Flow

## Overview

Use this skill to turn unclear, sprawling, or high-impact work into a frozen architectural path before implementation begins.

This skill is for situations where the user has many ideas, many moving parts, unclear direction, or real architectural contradictions. The goal is to prevent premature implementation and replace it with a session-tracked decision process.

## Non-Negotiable Rule

Everything in this flow must be tracked inside the active session file.

Do not create separate ad-hoc analysis notes for the core reasoning.

The session file is the audit trail because work done through this structure changes the system, and system-changing decisions must be journaled.

Allowed supporting artifacts:
- canonical approved documents such as `.skills/VISION_ARCHITECTURE.md`
- reusable references inside this skill

But the live investigation, decisions, tradeoffs, and chosen path must always be appended to the current `.sessions/SESSION_[date]-[name].md`.

## When To Use

Use this skill when:
- the user says the problem is messy, unclear, or "spaghetti"
- many good ideas exist, but the direction is not frozen
- implementation started too early
- multiple valid paths exist and the best path is unclear
- the user wants architecture before coding
- the work will change how the system thinks, stores memory, activates methods, or executes tasks
- the user wants to reason through TRIZ, IFR, first principles, research, and rigorous decision-making before building

## Output Contract

This skill should produce:
- a session-tracked architectural investigation
- a frozen sequence from Vision through Rollout
- explicit contradictions and resolution principles
- a chosen best path
- clear implementation criteria
- a decision on whether prototype/pilot is needed

Optional promoted artifact after agreement:
- a canonical architecture document such as `.skills/VISION_ARCHITECTURE.md`

## Session Tracking Protocol

Inside the active session file, add a dedicated subsection under `## Investigations` or append to the current architecture investigation using this exact sequence:

1. `Vision`
2. `Sync With User`
3. `IFR`
4. `Reality Map`
5. `Contradictions`
6. `Resolution Principles`
7. `Options / Best Path`
8. `System Structure`
9. `Operational Model`
10. `Implementation Criteria`
11. `Prototype / Pilot`
12. `Implementation`
13. `Testing + Verification`
14. `Iteration / Rollout`

For each section, write:
- the current understanding
- the evidence or reasoning behind it
- unresolved gaps, if any
- the decision, if one was reached

## Workflow

### Step 1: Create Or Reuse Session

- Read `MEMORY.md`
- Create or reuse the active session
- Confirm that the work belongs to the same thread or start a new session
- Record the user's request and core question first

### Step 2: Freeze Direction Before Coding

Do not implement yet.

First walk through:
- Vision
- Sync With User
- IFR
- Reality Map
- Contradictions
- Resolution Principles

At this stage, the job is to understand the system and the destination, not to build.

### Step 3: Choose The Best Path

Only after the contradictions are explicit:
- compare options
- reject weak paths explicitly
- choose the best path

The best path must be explained, not just selected.

### Step 4: Define The System

Then define:
- System Structure
- Operational Model
- Implementation Criteria

This is the freeze point for architecture.

### Step 5: Decide On Prototype

Treat prototype/pilot as optional.

Use it only if:
- the architecture is still uncertain
- a mechanism needs proof
- the wrong implementation would be expensive

Do not let the prototype silently become the architecture.

### Step 6: Only Then Enter Delivery

After architecture freeze:
- Implementation
- Testing + Verification
- Iteration / Rollout

If the system is not frozen, go back upward instead of coding forward.

## Cognitive Stack Guidance

These methods are one stack seen from different sides:

- `Thinking` improves reasoning quality
- `Research` acquires reality and evidence
- `TRIZ` resolves contradictions
- `IFR` defines the destination
- `TnR` is escalation for high-stakes or low-certainty work

Use the minimum necessary depth first, then escalate.

## Decision Rules

- Do not build on assumptions when relevant facts can be found.
- Do not accept hidden contradictions.
- Do not treat skill accumulation as architecture.
- Do not allow implementation to outrun vision.
- Do not leave the session file without the reasoning trail.
- Do not present a path as final if options were not meaningfully compared.

## Promote To Canonical Document Only After Freeze

If the user agrees that the architecture is frozen, promote the result into a canonical document such as:
- `.skills/VISION_ARCHITECTURE.md`

The session remains the detailed audit trail.

The canonical document becomes the condensed governing frame.

## Reference

For the condensed section sequence and section intent, read:
- `references/canonical-sequence.md`

