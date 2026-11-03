---
name: package-explorable
description: "Creates a submission ZIP of an existing explorable and its authoring transcripts. Use when asked to package an explorable, make its submission ZIP, or prepare it to submit. Does not create or revise the presentation, or upload the submission."
---

# Package an Explorable

Run this from the project root:

```bash
python3 explorables/tools/package_explorable.py
```

If the project has multiple explorables, pass the intended paper's folder name
as the argument. Ask which one only if it is unclear from the conversation.

Let the script handle validation, transcript capture, and file exclusions.
If it fails, report the error; do not claim a new ZIP is ready.

On success, link the ZIP at the path printed by the script. By default it is
`<project-root>/<paper-folder>.zip`, beside the starter's `README.md`.
Tell the author to upload it with the submission form.
