# Critique Implemented Work

Use this after completing and checking a meaningful increment. Review the artifact that now exists, not the intended design.

## 1. Ask a subagent for a focused review

When subagents are available, call one for an independent, read-only critique, and wait for it before presenting findings. Supply:

- the user's confirmed intention, audience, constraints, and choices to preserve;
- the changed artifact: files, relevant slides or widget states, and a command or preview to run it;
- sources, the checks that actually ran, and what remains unverified;
- only the relevant resource files, including their error-code tables.

A suitable request:

> Review [artifact] against [confirmed intention] using [resources and error codes]. Inspect the implementation and evidence; do not edit files or contact the user. For each supported finding, give the error code (or "no existing code"), the location and evidence, why it matters for the reader or the paper's fidelity, a concrete remedy with any tradeoff and a check for it, and a question asking the user whether to make it. Separate observed failures from design hypotheses. Do not reopen settled choices without new evidence. Say what you could not check, and report no material findings when that is the case.

## 2. Check the critique

Verify each finding against the artifact, the sources, and the user's decisions. Discard unsupported or irrelevant claims and merge overlapping ones. Fix clear errors within the agreed work, rerun the relevant checks, and report them as fixes. A remedy that changes the agreed design, scope, or claim goes to the user first.

## 3. Ask concrete improvement questions

Report the result and what was checked. Then present the most useful remaining findings, usually one to three, as questions that connect an observation, its consequence, and a proposed change, with the error code for traceability:

> The first lesson shows eight unfamiliar metrics, so it is hard to see which change matters (EXP-CONCEPT-PILEUP). Shall I show only the two measures this comparison needs, with the rest available on demand?

Mark uncertain diagnoses as possibilities and propose a check that would settle them. Do not ask only "Any feedback?", list bare codes, or invent questions when the review found nothing material. Wait for the answer before optional changes; it confirms the next increment. Request another critique only when the work has materially changed.

## When subagents are unavailable

Say that independent review is unavailable, then perform a separate, explicitly labeled self-review with the same resources and codes, and present its questions the same way. Never claim a subagent reviewed work when none ran.
