# Build and Validation

Open the actual explorable and try it. Check the model, the interface, and the reader's reasoning separately: a screenshot cannot show that a control works, a working control cannot show that it computes the right rule, and finishing it does not show understanding.

## Principles

- **Prototype the current uncertainty.** Build one representative interaction and try it before building the rest. A layout that suits one explanatory job may not suit framing or results.
- **Verify the assembled experience.** Check the widget inside the presentation, with its surrounding copy and navigation, at the intended size. Exercise initial, intermediate, completed, reset, and unavailable states, the keyboard, and focus. Confirm that the visible version contains the change; a source edit is not delivery.
- **Walk it as a newcomer.** For each step, ask who to follow, what to try, and which observation establishes the takeaway. Remove untaught state instead of adding instructions.
- **Diagnose confusion before fixing it.** Keep the reader's words and the state where the question arose. Decide whether the gap is a missing prerequisite, a hidden causal step, a representation, a definition, or wrong behavior, and inspect or vary the state to tell them apart. Choose a proportionate remedy (more prose is one option, not the default) and a new prediction that checks it. Do not claim the reader now understands.
- **Reuse verified computation.** Embed the real widget or share code with the verified system; check parity when porting. Keep display transformations out of model inputs.
- **Plan for missing services.** If a live model or backend is unavailable, show an honest recording or static alternative, labeled as such.
- **Reconcile after changes.** When a mechanism, example, or order changes, trace it through captions, transitions, speaker notes, citations, descriptions, and checks. Refer to slides by stable IDs. After reordering, reread moved slides with their neighbors so no transition assumes what has not yet been shown. Retire the old rule, and preserve the user's edits and settled choices.

## Error codes

| Code | Symptom | Test |
| --- | --- | --- |
| EXP-SCREENSHOT-ONLY-VERIFICATION | Visual inspection is the only evidence that the demos work. | Run an action, a contrast, reset, and the keyboard path at the target size. |
| EXP-COMPLETION-AS-LEARNING | Completed clicks or positive reactions count as comprehension. | Ask for a new prediction and the reason behind it. |
| EXP-DETAILS-BEFORE-QUESTION | Implementation vocabulary crowds out the phenomenon being explained. | Remove each detail from the main view; keep it only if it changes the reader's next interpretation or action. |
| EXP-EXPLANATION-DRIFT | Prose, settings, notes, citations, and widgets describe different versions. | Trace one changed rule through the widget, copy, sources, and checks. |

Background: [Crouch et al. (2004)](https://mazur.harvard.edu/publications/classroom-demonstrations-learning-tools-or-entertainment) found that students who predicted a demonstration's outcome understood it better than those who only watched.
