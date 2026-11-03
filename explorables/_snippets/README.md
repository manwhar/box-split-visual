# Demo snippets

Small, working examples of how a demo page works with the deck. Each one
shows a single mechanism, with comments in its source saying why it's done
that way. Copy the code you need into your own demos.

These snippets show the engine's mechanics, not how an explorable should
tell its paper's story or look. Their slides are deliberately plain, and
their content (dots, coin flips, a queue) has nothing to do with any paper.
Choose your explorable's structure, layout and wording from the paper you're
presenting, not from here.

See them running on the local server:

```bash
python3 explorables/serve.py
```

then open http://localhost:8790/explorables/_snippets/ (the gallery leaves
out folders whose names start with `_`, so type the address).

| Snippet | Slide | What it shows |
|---|---|---|
| [`canvas/`](canvas/index.html) | `#sharp-canvas` | Keeping a canvas sharp when the slide enlarges it (`deck:resolution`, not `devicePixelRatio`), and pausing animation when the slide goes off screen (`deck:visibility`). |
| [`variants/`](variants/index.html) | `#one-variant`, `#side-by-side` | One page serving several slides through a query parameter (`?variant=…`), with a visible fallback for unknown values; a seeded first view, so the slide and its preview picture are the same every time; `data-analytics-id` on controls; two frames side by side in one `play-set`. |
| [`recording/`](recording/index.html) | `#recorded-run` | Replaying recorded data loaded with `fetch()`: where to keep the file so it's published, loading and error messages, labeling playback as a recording, and pausing playback with the slide. |

`_template/demo/index.html` is the simplest demo: a slider, a chart, and an
animation that pauses with its slide. The [Demos section of
CONTRIBUTING.md](../CONTRIBUTING.md#demos) describes the whole demo format,
and `engine/js/playables.js` is the deck's side of these messages.

`tests/snippets-browser.mjs` runs each snippet in the real deck, so the
snippets keep working as the engine changes.
