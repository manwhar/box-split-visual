# Box-Split Grammars Tools

## 2D Minecraft Mockup Studio (`minecraft_mockup.py`)

Launches a local browser-based editor for composing crisp 2D Minecraft architecture mockups from the textures in `../demo/assets/` and exporting transparent PNG renders alongside editable `.json` project files.

### Run

From `box-split-visual/explorables/box-split-grammars/`:

```powershell
py tools/minecraft_mockup.py
```

Options:
- `--port <N>` — bind a specific port (defaults to `8765` or the next free port).
- `--host <ADDR>` — bind address (defaults to `127.0.0.1`).
- `--no-browser` — start the server without automatically opening a browser tab.

Requires Python 3.10+ (standard library only; no third-party dependencies).

### Features

- **Custom grid sizing**: Set width and height (up to 64×64 blocks) with Bottom-Left, Top-Left, or Center resize anchoring.
- **Foreground & Background modes**:
  - **Foreground (`1`)**: Full brightness blocks that cast border shadows onto nearby background blocks.
  - **Background (`2`)**: Recessed blocks rendered at lower brightness with ambient/edge shadows along foreground boundaries.
- **Official block scaling**: Automatically handles 1×1 blocks (`16×16`), 1×2 multi-blocks (`oak_door.png`, `16×32` with transparent windows), auto-connecting `cobblestone_wall.png`, and upright or wall-mounted `torch.png`.
- **Export & Reload**: Exports `<name>.png` (transparent background, crisp nearest-neighbor scaling) and `<name>.json` directly into `demo/assets/`. Use **Load Saved** or **Open JSON** to reload and edit any exported mockup later.
