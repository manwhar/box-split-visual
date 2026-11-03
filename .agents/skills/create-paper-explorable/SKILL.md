---
name: create-paper-explorable
description: "Turns a research paper into an explorable: an interactive explainer or slide deck with live demos where readers change an assumption and see what follows. Recreates and checks the paper's system, derives small teaching interactions, and refines them by trying them. Should trigger when asked to make an explorable, interactive explainer, or demo of a paper; turn a paper into slides with live demos or a guided simulation; fix, clarify, or critique an existing explorable or its widgets; write its gallery description; or package or submit an explorable. Should NOT trigger for a standalone paper summary or literature review, citation formatting, or UI work unrelated to explaining research."
---

# Create a Paper Explorable

An explorable rebuilds one research paper so that readers can change an assumption and see what follows. Build it on a working recreation of the paper's system, add one inspectable cause at a time, and check each step by trying it.

## 1. Find the current work

Inspect the paper, any code, the current explorable, and the project's instructions to establish what works and what the user wants next. Ask only for information that changes the next action. A new paper starts with recreation; work on an existing explorable starts at the requested aspect, so fixing a caption does not restart recreation.

If the project contains `explorables/engine/`, it is the explorable starter project: read [The starter project](resources/this-repo.md) before creating files, previewing, or packaging.

While working on an explorable in that project, register the exact author conversation and set up its completion hooks using the transcript procedure in that resource. Explain the current app’s approval or enablement step after setup, using that resource; installed files alone do not establish that hooks are active. Keep recovery checkpoints on discussion-only turns and resumed chats too. The submission includes these archives for feedback on the authoring process and improvements to this skill.

## 2. Hold to six principles

1. **Recreate the real system before teaching it.** Get the paper's complete mechanisms, configurations, and evaluation path running, reusing faithful original code where possible. A toy, mock, or replay is not a recreation. Choose teaching reductions afterward and check them against it.
2. **Keep every claim traceable.** Tie each claim and rule to the paper or the implementation. Keep the paper's evidence, your local runs, and authored illustrations visibly distinct, and disclose every changed assumption.
3. **Teach one cause per step.** Each step adds one mechanism whose effect the reader can see and explain from earlier steps, with a contrast showing when it does not happen.
4. **Count new predictions as learning; clicks are not.** Decide what the reader should be able to predict or question afterward, and check it with a case they have not seen.
5. **Try the real experience.** Open the assembled explorable at its real size, use its controls, and inspect intermediate and reset states. A screenshot or a passing unit test is not verification. Say what remains untested.
6. **Get an independent critique of implemented work and turn it into questions.** Findings become concrete questions the user can accept or decline.

## 3. Confirm, implement, critique

Repeat for each meaningful increment.

1. **Confirm the intention.** State the next change, why it helps, and how it will be checked. Wait when the direction is not yet agreed. An explicit request or earlier agreement already confirms it; acknowledge it and proceed. Confirm the next increment, not a whole presentation plan.
2. **Implement and check.** Read the resource for the work (below), make the change, and run the checks it calls for. When asked to build, build; do not stop at a proposal.
3. **Critique.** Follow [Critique implemented work](resources/critique.md), and wait for the user's answers before making optional changes. When the user asked only for a review, plan, or answer, that is the deliverable: give it directly, without a subagent critique of it.

## 4. Load guidance as needed

Read only the resource for the work at hand. Paths are relative to this skill's folder.

| Work at hand | Read |
| --- | --- |
| Recreating, running, or checking the paper's system | [Full recreation](resources/full-recreation.md) |
| Framing the contribution, choosing evidence and figures, writing descriptions | [Core ideas](resources/core-ideas.md) |
| Choosing what readers should learn, reducing the system, sequencing interactions | [Reader journey](resources/reader-journey.md) |
| Trying the assembled explorable, fixing an interaction, responding to confusion | [Build and validation](resources/build-validation.md) |
| Reviewing a finished increment | [Critique implemented work](resources/critique.md) |
| Seeing how the principles played out in earlier explorables | [Worked examples](resources/worked-examples.md) |
| Working in the explorable starter project | [The starter project](resources/this-repo.md) |

Each resource ends with error codes for critiques and questions.

## 5. Stay honest about scope

- A functional recreation is not a reproduction of the paper's numbers, and a pending benchmark does not undo verified function. Leave active runs alone.
- Preserve the user's direct edits, filenames, and settled choices. When a decision changes, update the affected copy, notes, and checks, and retire the old instruction.
- Settle factual uncertainty by inspecting or running things, not by asking the user. Without the ability to execute, give code or worked expectations and label them as not run.

## 6. Deliver

Link the working artifact and say how to open it. State what changed, which checks ran, what remains unverified, and the critique's questions. Do not claim the explorable teaches effectively without evidence from readers.
