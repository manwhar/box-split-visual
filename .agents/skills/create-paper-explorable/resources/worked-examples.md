# Worked Examples

These examples show how the principles shaped this repository's explorables. Adapt the reasoning, not the layout, cast, or chapter order; choose the structure each new paper needs.

## Sequencing an economy (The AI Economist)

In the paper, workers gather, trade, and build in a simulated economy while a learned planner sets taxes.

- **Order by first effects.** Adding a market to untrained workers shows nothing interesting: no useful trades and no roles. If learning came next, specialization would first appear in that step, so readers would meet learning and specialization at once (EXP-DELAYED-EFFECTS). The deck instead teaches one worker gathering and building, then a policy choosing actions, then learning. Only then does it add the market, so that specialization becomes the market step's own payoff. Taxes come last, because adapting to taxes means learning under changed incentives.
- **Find hidden prerequisites.** A "building" lesson silently assumes readers know where resources appear and how gathering works. The deck starts with the world (resource placement and regrowth), then a worker the reader steers by hand.
- **Focus the display.** The first lesson shows only the resource map and its controls. The four-agent lab, order book, and tax charts appear when a later lesson asks a question they answer. Embedding the full lab with a note to "ignore these for now" would create EXP-CONCEPT-PILEUP.

## Keeping a world as an anchor (Economist Lab)

The user chose a persistent world beside Agent, Market, and Overview tabs. The contract for that layout: switching tabs changes only the inspector; the world, playback position, camera, and selection stay put; and every view shows data only up to the displayed time, including after a backward seek. This is a contract for that chosen layout, not a default.

## Measures and clocks in a recorded run

- Labeling an agent's current wood as "total gathered," or counting an open sell offer as a sale, confuses state with history and offers with completed trades (EXP-UNDEFINED-MEASURE).
- A planner with fixed policy weights picks a new tax schedule each tax period. A caption claiming that each change means it "learned a better policy" confuses decisions with training updates. Label the recording as an evaluation of one checkpoint, and separate steps, tax periods, episodes, and optimization.

## Showing an intermediate representation (Generative Agents)

An agent's movement does not show why it acts. The deck's reaction lesson follows retrieved memories into the language-model prompt, compares example answers, and shows what the engine applies, because that intermediate representation is the mechanism. A paper whose mechanism is not a prompt has no reason to show one. The deck labels teaching examples (an authored fire, dialogue, and prompts) separately from the archived run it replays, and both separately from the authors' evaluation.

## Adapting an existing explorable (Schelling)

The Schelling deck arranges Vi Hart and Nicky Case's *Parable of the Polygons* as slides and adds research context. The byline credits the original, while the description still leads with the research idea: mild preferences for similar neighbors can produce strongly segregated towns, so collective outcomes need not reflect what individuals want.
