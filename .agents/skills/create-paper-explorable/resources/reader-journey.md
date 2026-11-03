# Reader Journey

A collection of controls is not a causal explanation. Decide what the reader should be able to reason about afterward, then derive each interaction from the verified system.

## Choose the reasoning goal

- **Name a capability, not a topic.** State a new case the reader should be able to predict, question, or extend afterward, and the explanation they should give. Remembering terms or completing clicks is not a goal.
- **Connect it to the contribution.** The paper's contribution says what the research adds; the goal says what this audience can do with it. Do not replace a general contribution with a narrow application question.
- **Pick the medium for the goal.** Use the paper's figure to inspect a reported comparison, a sentence to establish a fact, and an interaction to test a prediction or a changed assumption.

## Principles

- **Teach with a small whole.** Choose a reduced example that still completes a meaningful cycle, and record what changed and which rules are identical. Unchanged local rules do not prove a reduction is faithful: removing interactions, scale, or initial conditions can remove the very behavior being taught. Run a contrast that would reveal the loss, and revise the example or narrow the claim if it fails.
- **Order by understanding, not by component.** Find the prerequisites hidden in a simple-looking task. Mark where each mechanism first produces an observable effect. If two mechanisms first show effects in the same step, that step teaches two things even though they were introduced separately; reorder or choose another faithful example.
- **Show why it happens and why it sometimes does not.** Compute the real condition and make it visible. The contrast should separate the real rule from an appealing wrong one.
- **Focus each step.** Foreground the subject, control, and state that connect the new cause to its effect, with the smallest cast that shows it. Keep earlier context only where it supports the explanation. Withhold untaught mechanisms instead of telling readers to ignore them, and keep a route to the full system elsewhere.
- **Keep continuity.** Reuse the world, data, and visual vocabulary where it helps, and show an earlier step's output entering the next mechanism.
- **Make the process visible.** Show inputs, intermediate results, and consequences as they become available, and mark what is still unresolved. Distinguish unavailable from zero. Show only the intermediate detail that serves the lesson; motion alone does not explain.
- **Guide, then open up.** Start with a question, a prepared state, one action, and what to notice. Later, let readers vary assumptions, challenge results, or extend the system.

## The interaction contract

For each step: question → prediction → intervention → computed rule → visible result → explanation. Build and try one step before specifying the rest. To exit a step, the reader should be able to make a new prediction using it and the earlier steps. If explaining the outcome needs a later mechanism, revise the sequence or the example.

## Comparisons and measures

- Vary one cause at first and hold or record the rest, including seeds. For stochastic systems, show variability; one paired run does not prove an effect.
- Define each measure: what it counts, its units, time window, and aggregation. Match legends to the marks drawn, keep encodings and scales consistent, and choose a measure that can tell the competing explanations apart. Two curves with the same shape may be one quantity in different units.
- Label authored examples, selected recordings, changed parameters, and live computation. A playback control must not look as if it recomputes.

## When the explorable shows a running system

- Distinguish current state (what is held now) from accumulated activity (what has happened), and attempted or offered events from completed ones. History and totals stop at the displayed time, including after seeking backward.
- Separate the clocks: steps, decision points, episodes, and training updates. A fixed policy choosing different actions is not learning.
- When readers compare entities, show them together with consistent colors, time windows, and comparable axes rather than one at a time.

## Error codes

| Code | Symptom | Test |
| --- | --- | --- |
| EXP-RECALL-AS-GOAL | Goals require only remembering terms or following the prescribed clicks. | Name an unfamiliar case and the explanation the reader should be able to give. |
| EXP-LOOKALIKE-CAUSE | Timing, screen position, or a button stands in for the real condition. | Change the true input while holding the visual cue steady; does behavior follow the rule? |
| EXP-CONCEPT-PILEUP | One step needs several unexplained mechanisms, agents, or metrics. | Audit the whole display: can the reader name the subject, try one action, and explain its effect from earlier steps alone? |
| EXP-DELAYED-EFFECTS | Mechanisms are introduced separately but first show effects together. | Mark each mechanism's first observable effect and split any shared payoff. |
| EXP-SANDBOX-WITHOUT-QUESTION | Many controls and "play around," with no starting question. | Name the first intervention, what to notice, and the question it answers. |
| EXP-UNDEFINED-MEASURE | A number mixes state with history, units, or time windows, or shows data past the displayed time. | Say what it counts, over which window, and check its value at the displayed time. |
| EXP-ILLUSTRATION-AS-EVIDENCE | Authored values or selected recordings look like computed findings. | Can readers tell what was generated, what was chosen, and what recomputes? |

Background: [Victor, Up and Down the Ladder of Abstraction](https://worrydream.com/LadderOfAbstraction/); [Alfieri et al. (2011)](https://openresearch.surrey.ac.uk/esploro/outputs/journalArticle/Does-Discovery-Based-Instruction-Enhance-Learning/99515521902346) on discovery supported by feedback and examples.
