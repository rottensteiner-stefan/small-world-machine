# Pixler (Pixel Art Editor)

**Pixler** is a retro-style pixel art editor you can open without leaving your game — draw a sprite, copy it to the clipboard, and paste it straight into your asset pipeline.

## Enabling it

Call `attachDevTools(app)` from `@small-world-machine/tools`, and Pixler opens as one of the docked Forge windows:

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const app = new MyGame();
attachDevTools(app);
app.start();
```

Press **Ctrl+Alt+G** (or **Cmd+Alt+G**) to show/hide the Forge overlay.

::: tip Standalone page
Pixler is also available as the `pixler` mode of the Maker shell (`/tools/maker.html#pixler`) — the same class, mounted into the shell's mode surface instead of a Forge window. Xtractor's "Send to Pixler" handoff works there too: the shell parks the crop in Pixler and switches to it. Leaving the mode and coming back restores the picture; the undo history starts fresh.
:::

## Tools

Four tools, switchable via the toolbar or a keyboard shortcut:

| Tool | Key | Notes |
|---|---|---|
| Pencil | `P` | Default tool; single-pixel drawing. Right-click erases. |
| Bucket Fill | `F` | Flood-fills matching the exact color under the click. |
| Color Picker | `I` | Samples the color under the cursor. `Alt`+click works as a one-off pick regardless of the active tool. |
| Line | `L` | Bresenham line between consecutive clicks, so you can chain segments. `Shift`+click also draws a line, regardless of the active tool. |

## Canvas, palette, and grid

- **Size** — starts at 32×32px at 16x zoom; the `W`/`H` inputs resize it while preserving existing pixel data.
- **Zoom** — a numeric input, not the mouse wheel; there is no zoom shortcut.
- **Palette** — a dropdown of six built-in palettes (Default, EGA, VGA, PICO-8, Game Boy, Grayscale). Number keys `1`–`9` jump directly to a palette slot.
- **GridX/GridY** — a secondary magenta overlay grid, purely a visual reference (e.g. to mark tile boundaries) — it has no effect on export; there is no tiled/multi-frame export.

## Symmetry mode

Two independent toggles (X-axis 🪞X and Y-axis 🪞Y) mirror every pencil and line stroke as you draw — enable both for 4-way symmetry. Important: **Bucket Fill does not respect symmetry mode** — only direct pencil/line strokes are mirrored.

## Editing

- **Undo/Redo** — `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`, up to 50 steps.
- **Pan** — `Shift` + arrow keys/WASD shifts the sprite content, wrapping at the edges (this moves pixel data, not the viewport).
- **Flip** — keyboard-only: `Ctrl/Cmd+Shift` + Up/Down (or W/S) flips vertically, `Ctrl/Cmd+Shift` + Left/Right (or A/D) flips horizontally. There is no toolbar button and **no rotate** — only the two mirror axes exist.
- **Trim** — the ✂️ button automatically crops to the bounding box of non-background content. "Background" means fully transparent pixels, or pixels matching the currently selected color if that color is not transparent (so you can also trim away a solid-color border, not just transparency).
- **Clear** — clears the canvas (with a prior undo step saved).
- **A-Z template** — loads a built-in bitmap font as a starting point.

Full shortcut reference: arrow keys/WASD move a cursor cell by cell (drawing while a stroke is active), `Space` draws at the cursor, `X`/`Delete`/`Backspace` erases at the cursor. Shortcuts are suspended while a text input field is focused.

## Getting sprites in and out

- **Copy as Base64** — the 📋 button copies a PNG data URL to the clipboard.
- **Copy as Image** — the 💾 button writes an actual PNG blob to the clipboard, so you can paste it into other apps (or back into Pixler, or another tool).
- **Import** — Pixler embeds a `UniversalIngestDropzone`: file picker, folder, URL, drag & drop onto the window, and paste (`Ctrl/Cmd+V`). It accepts images, SVG (rasterized to 64 px), PBR sets, ZIP archives, files and text.
- **From Xtractor** — see [Xtractor](/guides/xtractor)'s "Send to Pixler" button, which pushes a crop directly to the Pixler instance listening on the shared event bus.

There is no filesystem save — export only happens via the clipboard — and no sprite sheet/animation frame support; this is an editor for single static images.

## Limitations

- **Single image only** — no frames, no animation, no tiled sprite sheet export (the GridX/GridY overlay is a visual aid only).
- **No rotate**, only horizontal/vertical mirroring.
- **Bucket Fill ignores symmetry mode.**
- **Sprite content does not persist across reloads in the docked Forge window** — `getState()`/`setState()` exist on the class, but the Forge window manager never calls them, so only the window's open/closed state survives a reload, not what you drew.
- In the Maker shell the undo history is per mount: leaving the mode keeps the picture, not the history.
