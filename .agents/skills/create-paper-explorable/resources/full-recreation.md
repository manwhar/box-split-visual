# Full Recreation

A persuasive animation can hide an incomplete system. Establish what actually runs before deciding what to simplify for readers.

## Principles

- **Recreate the whole research object.** Cover the mechanisms, configurations, inputs, training, and evaluation that the paper's claims depend on. If the user explicitly narrows the scope, name what the partial version leaves out.
- **Reuse behavior, not reputation.** Run the original code and check it against a list of the mechanisms the paper requires; a popular fork may drop a central one. Copy in only what is needed, with its license and source.
- **Pin versions and record disagreements.** Where the paper and code differ, record which interpretation runs and how it was checked. Do not quietly pick the easier one.
- **Name the kind of evidence you have.** A unit test, an end-to-end run, inference from the authors' checkpoint, fresh training, and a protocol-matched reproduction of the paper's numbers each support a different claim. Compare like with like: the same metric, baselines, seeds, and budget.
- **Keep run evidence.** Save the revision, environment, seeds, parameters, metrics, and enough events to inspect behavior. For paid models or services, also keep inputs, versions, outputs, and cost, and checkpoint completed work so inspecting it never means paying again. Mock outputs check an interface, not the service's behavior.
- **Turn limits into named work.** Missing compute, data, or a model is a dependency to state, not permission to substitute a cheaper system. Framing from the paper can proceed while long runs continue; keep teaching prototypes provisional until the system is verified, and leave running experiments alone.

## When the paper is not a simulation

"The system" is whatever produces the paper's claims. Recreate that, and say plainly what cannot be recreated.

- **Algorithms, models, and simulations:** the runnable code and configurations, as above.
- **Empirical or statistical analyses:** the analysis pipeline. Rerun it on the released data and check that it reproduces the reported tables or figures. If the data is unavailable, run the pipeline on clearly labeled synthetic data with the same structure, and never present that as the authors' result.
- **Formal and theory papers:** the model's definitions and its derivations. Implement the model so its assumptions can be varied, and check it against the paper's stated results and special cases.
- **Qualitative studies:** the analytic chain, not the participants. Collect the paper's quoted evidence, its codes or themes, and how each supports a claim, so readers can examine how conclusions rest on evidence. Never fabricate participants, quotes, or data; label any composite or hypothetical example.
- **Systems without released code:** the described behavior. Implement the parts the claims depend on, and mark which details are inferred from the text.

## Error codes

| Code | Symptom | Test |
| --- | --- | --- |
| EXP-TOY-AS-RECREATION | A small demonstrator or hand-authored behavior stands in for the paper's system. | Can the implementation run the paper's complete path without the teaching shortcut? |
| EXP-CHECKPOINT-AS-TRAINING | Replaying the authors' trained model is offered as evidence that the recreated training works. | Point to the run that updated parameters from initialization, its configuration, and its evaluation. |
| EXP-RUNS-AS-RESULTS | Passing tests or an attractive run is described as reproducing the paper's outcome. | Compare against a protocol-matched measurement and list what remains unverified. |
| EXP-SILENT-SUBSTITUTION | An unavailable model, dataset, mechanism, or schedule is replaced without disclosure. | Can a reader find every changed assumption and tell its results from the paper's? |
