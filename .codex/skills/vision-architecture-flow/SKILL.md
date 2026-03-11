---
name: vision-architecture-flow
description: Structure messy, high-leverage work before implementation by freezing Vision, Sync With User, IFR, Reality Map, Contradictions, Resolution Principles, Options/Best Path, System Structure, Operational Model, Implementation Criteria, Prototype/Pilot, Planning, Implementation, Testing + Verification, and Iteration/Rollout. Use when the user has an unclear or sprawling problem, when architecture must be defined before coding, when multiple paths exist, or when the system risks premature implementation. Always track this structure inside the active `.sessions/SESSION_[date]-[name].md` file as the audit trail of how system-changing decisions were made.
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

This flow must also be visible to the user, not only to the session log.

Do not silently compress multiple stages into one polished synthesis and present downstream conclusions as if the user had already walked through them with you.

If the user has not explicitly delegated architecture choice (`everything up to you`, `choose for me`, equivalent), then downstream conclusions remain provisional until the user has been visibly walked through the upstream stages.

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
- a user-visible stage-by-stage walkthrough
- a frozen sequence from Vision through Rollout
- explicit contradictions and resolution principles
- a chosen best path
- clear implementation criteria
- a decision on whether prototype/pilot is needed
- a recorded plan before implementation begins

The user should always be able to answer:
- what stage we are in right now
- what is already jointly understood
- what is still open
- whether a stated conclusion is a working hypothesis or a frozen decision

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
12. `Planning`
13. `Implementation`
14. `Testing + Verification`
15. `Iteration / Rollout`

For each section, write:
- the current understanding
- the evidence or reasoning behind it
- unresolved gaps, if any
- the decision, if one was reached

Also mark whether the section state is:
- `working hypothesis`
- `discussed with user`
- `frozen`

Do not mark a section as effectively frozen if the user has not been walked through it.

## User-Facing Stage Protocol

At the start of the flow, explicitly tell the user:
- the current stage
- why this stage comes before the next one
- what you are trying to learn or resolve here

Whenever moving to the next stage, explicitly state:
- `We are now at: <stage>`
- what was established in the previous stage
- what remains unresolved

If you perform research ahead of a future stage, present it only as input material, not as a settled downstream conclusion.

Never talk as though the work is already in `Options / Best Path`, `Implementation`, or `Phase 1` if the user-facing discussion is still in `Sync With User`, `Reality Map`, or `Contradictions`.

## Stage Gate Rule

Do not silently descend the flow.

Before progressing from one stage to the next:
- summarize the current stage in user-facing language
- make clear what is known vs uncertain
- state whether you think the stage is sufficiently understood
- allow the user to correct, refine, or reopen it

If the user does not explicitly delegate the choice, treat agreement as something that must be earned through visible discussion, not inferred from silence.

## Rollback Rule

If the user says:
- "we are moving too fast"
- "I do not feel we went through the flow"
- "Reality Map / Contradictions / Options were not discussed"
- or any equivalent correction

then immediately:
1. acknowledge the process miss
2. roll back to the last jointly understood stage
3. relabel downstream conclusions as `working hypotheses`
4. continue from the corrected stage order

Do not defend the compressed path. Repair the flow and continue visibly.

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

Important:
- announce each of these stages explicitly to the user
- do not bundle them into one dense answer unless the user explicitly asks for compression
- if you have already reasoned ahead internally, still present downstream material as provisional until the user catches up through the visible flow

### Step 3: Choose The Best Path

Only after the contradictions are explicit:
- compare options
- reject weak paths explicitly
- choose the best path

The best path must be explained, not just selected.

If options have not been shown to the user in a visible way, you are not yet at this step from the user's perspective.

#### When the best path is not obvious: Multi-Pass Convergence Search

If the first scan of options leaves a contested assumption — one that would change the choice if it turned out differently — do not guess. Run a structured multi-pass search until that assumption is either verified or ruled out by independent evidence.

This protocol applies to any domain. The field changes. The structure does not.

**Pass 1 — Internal scan + primary domain research**

Start inside. Read the current system, constraints, and existing decisions.
Then research the direct domain: what do existing solutions in this space look like? What has already been tried?

Produce:
- an explicit list of N options, each with: what it gives, what it fails at, what to reject, what to borrow
- a first-hypothesis best path labeled `working hypothesis`
- an explicit list of assumptions that are not yet verified

Do not skip to a conclusion if unverified assumptions remain.

**Pass 2 — Technical stress-test of the hypothesis**

Take each unverified assumption from Pass 1.
Go to primary sources: official documentation, changelogs, specifications, source code.
Do not re-use the same sources that produced the hypothesis.

For each assumption:
- confirmed → mark as `verified`, note the source
- refuted → update the option or introduce a new sub-option
- unclear → mark as `speculative`, note what is missing

If a refuted assumption changes which option wins, reopen the choice explicitly.
Do not silently absorb the correction.

**Pass 3 — Adjacent domain research**

Find domains that are not direct competitors but share the same class of problem.
The field is different. The underlying tension is the same.

Examples of how to find adjacent domains:
- If the problem is about structuring knowledge → look at academic research tools, investigative journalism, legal case analysis, qualitative research software
- If the problem is about data migration → look at how database engineers, archivists, or logistics systems handle irreversible transitions
- If the problem is about user interaction patterns → look at industrial UX, medical device interfaces, physical tool design

For each adjacent domain:
- what does it reject that we were assuming?
- what interaction or data pattern does it use that we had not considered?
- does it change the architecture, or only add a borrowable layer?

Distinguish clearly:
- things that change the base architecture → reopen the option choice
- things that are useful future layers → note as borrowable, do not expand v1 scope

**Pass 4 — Second adjacent domain pass (disconfirming focus)**

Pick a different set of adjacent domains from Pass 3.
Focus specifically on the most contested remaining assumption — the one where Pass 2 and Pass 3 did not yet converge.

The goal of this pass is not to find more supporting evidence.
The goal is to find the strongest possible disconfirming evidence.

If this pass still points to the same answer as Pass 3 → the assumption is closed.
If it points to a different answer → a prototype or empirical test is required. Do not decide by argument alone.

**Convergence criterion**

The search is complete when:
- two independent passes, using different source domains, produce the same answer for the contested assumption
- a new pass adds no new options and does not change the relative ranking of finalists

If convergence has not been reached after four passes, do not extend the search further. Move to prototype instead.

**Multi-agent variant**

If two agents are working together:

- Agent Leader: runs Pass 1 and Pass 3 (synthesis and primary research)
- Agent Challenger: runs Pass 2 and Pass 4 (stress-test and disconfirming pass)

The Challenger must not repeat the same sources as the Leader.
The Challenger's job is not to undo the hypothesis but to find what the Leader could not see from their angle.

Both agents write to the same session file, marking each entry with their identity.
The Leader reads the Challenger's findings and updates the hypothesis or explicitly refutes the challenge with evidence.
The Challenger reads the Leader's response and either closes the challenge or escalates with a new source.

Convergence happens when Leader and Challenger independently reach the same answer from different source pools.

**Output of the search**

Before presenting the best path to the user, record in the session file:

- how many passes were run
- which domains were covered in each pass
- what was the contested assumption
- what evidence closed it or left it open
- which options were fully rejected, which were kept, which pieces were borrowed
- the final LEGO composition: base from X, borrow Y from A, borrow Z from B, defer W

Then present to the user:
- the options that were seriously considered (not just the winner)
- what was explicitly rejected and why
- what was borrowed from each rejected option
- the chosen path and the evidence chain behind it

Do not present only the conclusion.
The user must be able to see what was weighed, not only what was chosen.

### Step 4: Define The System

Then define:
- System Structure
- Operational Model
- Implementation Criteria

This is the freeze point for architecture.

Do not speak about implementation phases, pilot scope, or a chosen system shape as though they are settled if the user-facing flow has not visibly reached this step.

### Step 5: Decide On Prototype

Treat prototype/pilot as optional.

Use it only if:
- the architecture is still uncertain
- a mechanism needs proof
- the wrong implementation would be expensive

Do not let the prototype silently become the architecture.

### Step 6: Plan The Delivery

Before implementation, create and record a plan.

The planning stage exists to preserve synchronization, recoverability, and controlled execution when architecture is already frozen but implementation has not begun.

The plan should work like navigation:
- the destination and overall route stay visible
- the next meaningful turns are shown in higher detail
- deeper decomposition happens only when close enough to execute responsibly

The planning stage must explicitly decide:
- what can be done in one pass vs many passes
- what belongs to the next implementation slice
- what is intentionally deferred
- what assumptions may require re-checking during execution
- what level of decomposition is appropriate now vs later

Do not over-decompose the entire project if future implementation details are still likely to move.

Prefer:
- global path
- medium-grain work packages
- near-term execution detail for the next slice

This stage must be visible to the user because it is the synchronization bridge between frozen architecture and implementation.

### Step 7: Only Then Enter Delivery

After architecture freeze:
- Planning
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
- Do not allow implementation to outrun planning.
- Do not leave the session file without the reasoning trail.
- Do not present a path as final if options were not meaningfully compared.
- Do not treat internal model reasoning as shared user understanding.
- Do not treat background research as user-approved architecture.
- Do not skip visible synchronization just because you can infer a likely best answer.
- Do not enter implementation directly from architecture freeze without a recorded plan.
- Do not confirm a hypothesis using the same sources that produced it. Confirmation requires independent evidence.
- Do not present only the winning option. Show what was rejected, what was borrowed, and why. A conclusion without visible comparison is not an architecture decision — it is an assertion.
- Do not treat "adjacent domains" as decoration. If an adjacent domain solves the same class of problem differently, it either changes the architecture or adds a borrowable layer. Name which.
- Do not extend the search indefinitely when four passes have not converged. Move to prototype. Research alone cannot settle what only empirical evidence can resolve.
- Do not let two agents unknowingly duplicate each other's sources. When working in multi-agent mode, the Challenger must cover domains the Leader did not. Overlap produces false confidence, not convergence.

## Promote To Canonical Document Only After Freeze

If the user agrees that the architecture is frozen, promote the result into a canonical document such as:
- `.skills/VISION_ARCHITECTURE.md`

The session remains the detailed audit trail.

The canonical document becomes the condensed governing frame.

## Reference

For the condensed section sequence and section intent, read:
- `references/canonical-sequence.md`
