---
name: "solver-optics-thinker"
description: "Four-lens reasoning framework for complex, multi-layered problems: map the system, isolate the real constraint, reduce it to first principles, design an elegant high-leverage solution, and adapt it to messy real-world usage. Use when Codex needs to think deeply before acting, analyze a system, find root cause, resolve contradictions, choose between architectures or strategies, evaluate tradeoffs, or respond to prompts such as 'разберись', 'подумай', 'проанализируй', 'think', 'analyze', 'solve', or 'why is this happening'."
---

# Solver Optics

Use this skill to turn vague complexity into one decisive move. Work through four lenses in order. Compress the depth when the situation is simple, but do not skip Lens 2 or Lens 3.

## Operating Stance

- Separate `Observed` facts from `Inferred` conclusions and `Open` questions.
- Name the constraint, not the symptom.
- Prefer the smallest intervention at the highest-leverage point.
- Verify unstable or external facts before building conclusions on top of them.
- End with one concrete next action, not analysis without consequence.

## Depth Control

- Run the full four-lens pass for strategic, ambiguous, layered, or high-stakes problems.
- Run a short Lens 1 pass when the system and bottleneck are obvious.
- Run a short Lens 4 pass for purely technical tasks with minimal adoption risk.
- Slow down and expand the evidence section when the user asks to "think," "analyze," "understand what is really happening," or when multiple explanations fit the same symptom.

## Workflow

### 1. Frame the problem

Before the lenses, write a compact setup:

- `Objective`: what must become true
- `System boundary`: what is inside and outside the analysis
- `Success criterion`: what outcome would count as solved
- `Evidence available`: what is known now
- `Missing information`: what could materially change the answer

If the task is code- or product-related, tie the frame to the real system boundaries: modules, routes, APIs, actors, dependencies, environments, or workflows.

### 2. Lens 1: Map

Goal: map the system and locate the real bottleneck.

Do this:

- list the main system elements
- list the flows through the system: data, tasks, requests, decisions, attention, money, approvals, or state changes
- find where work queues, stalls, distorts, or gets dropped
- identify the bottleneck that constrains the rest
- prove why this node matters more than nearby symptoms
- state the leverage point: where a small change would shift the whole system

Ask:

- What moves through this system?
- Where does throughput collapse or quality degrade?
- Which single node, if improved, would unlock the most downstream movement?

Do not:

- optimize multiple areas at once before naming the main constraint
- confuse visibility with causality
- call a symptom the bottleneck without showing system impact

### 3. Lens 2: Scalpel

Goal: strip the bottleneck down to first principles.

Do this:

- list the assumptions, conventions, habits, analogies, and inherited rules around the bottleneck
- cut anything that is not a hard constraint
- keep only logical, physical, mathematical, contractual, or system-invariant truths
- restate the problem as a naked core with minimal story attached
- show deductions explicitly as `Inference`, not as disguised facts

Pressure-test with these questions:

- Which statements are real constraints and which are customs?
- What remains true even if the current implementation, process, or consensus disappears?
- What is the smallest accurate statement of the problem?

Typical non-laws to cut:

- "We always do it this way"
- "Competitor X does it this way"
- "This is standard practice"
- "Without this layer, it cannot work"

### 4. Lens 3: Compass

Goal: derive an elegant solution instead of a compromise pile.

Do this:

- define the `Ideal Final Result`: the function happens with minimal new mechanism
- phrase the contradiction clearly: improving A breaks B
- search for resources already inside the system
- prefer time, idle capacity, existing information, existing interfaces, side effects, proximity, defaults, or already-computed state over new layers
- generate one to three candidate moves
- choose the strongest move and explain why it resolves the contradiction
- name what should not be added

Ask:

- How would this work if I could not add a new subsystem?
- What does the system already know, already compute, or already expose?
- Which existing surface can carry the solution with the least added complexity?

Strong solutions usually:

- remove coordination instead of adding more of it
- reuse existing state instead of duplicating it
- move the fix to the point of cause instead of the point of pain
- reduce moving parts, branching, or human memory load

### 5. Lens 4: Mirror

Goal: make the solution survive real usage by real people.

Do this:

- identify the real user, operator, maintainer, or reviewer
- list the likely friction points, misreads, shortcuts, and failure modes
- adapt the solution so the correct path is the easiest path
- make errors visible and recoverable
- simplify wording, flow, and mental load
- define rollout, verification, and fallback if the change is non-trivial

Ask:

- Will the user understand this without extra explanation?
- What happens when someone is rushed, tired, or mistaken?
- What is the laziest path through this system, and does it still lead to the right behavior?

If nobody will use the solution correctly without instructions, the solution is not finished yet.

## Evidence Protocol

When writing the answer, keep this distinction explicit:

- `Observed`: directly seen in code, logs, metrics, user reports, or verified sources
- `Inferred`: deduced from the observed facts
- `Open`: unresolved questions that matter enough to note

Do not pad the answer with fake certainty. If a conclusion is a deduction, label it as one.

## Output Contract

Use this structure unless the user asked for a different format:

```markdown
## Frame
**Objective:** ...
**System boundary:** ...
**Success criterion:** ...

**Observed:**
- ...

**Inferred:**
- ...

**Open:**
- ...

## Lens 1: Map
**System:** ...
**Flows:** ...
**Bottleneck:** ...
**Why here:** ...
**Leverage point:** ...

## Lens 2: Scalpel
**Assumptions cut:**
- ...

**Fundamental truths:**
- ...

**Naked core:** ...

## Lens 3: Compass
**Ideal final result:** ...
**Contradiction:** if ..., then ...
**Internal resources:**
- ...

**Candidate moves:**
1. ...
2. ...

**Chosen move:** ...
**What not to add:**
- ...

## Lens 4: Mirror
**User / operator:** ...
**Friction points:**
- ...

**Adaptation:** ...
**Path of least resistance:** ...
**Rollout / verification:** ...

## Decision
**The real problem is:** ...
**The highest-leverage move is:** ...
**Why this is the right move:** ...
**Next step:** ...
```

## Common Failure Modes

- Jumping to fixes before naming the real constraint.
- Treating assumptions as laws.
- Importing solutions from analogies without checking fit.
- Adding new tooling, layers, or process when the current system already contains the needed resource.
- Producing many options when one recommendation is already defensible.
- Stopping at elegant theory without showing how it survives real behavior.

## Done Means

This skill has done its job when:

- the bottleneck is named clearly
- the real core is separated from noise
- the proposed move uses leverage instead of brute force
- the answer distinguishes facts from deductions
- the final recommendation is actionable now
