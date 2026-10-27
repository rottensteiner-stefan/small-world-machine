# Map Generator (Grid Level Editor)

**Map Generator** is a manual, tile-by-tile grid painter for building ASCII level layouts that [`GridLevelBuilder`](/guides/extensions) can turn into real 3D geometry. Despite the name, it generates nothing procedurally — think of it more as a spreadsheet-like painting tool for level data, not a random dungeon generator.

## Enabling it

Call `attachDevTools(app)` from `@small-world-machine/tools`, and Map Generator opens as one of the docked Forge windows:

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const app = new MyGame();
attachDevTools(app);
app.start();
```

Press **Ctrl+Alt+G** (or **Cmd+Alt+G**) to show/hide the Forge overlay.

::: tip Standalone page
Map Generator is also available as the `map` mode of the Maker shell (`/tools/maker.html#map`) — the same class, mounted into the shell's mode surface instead of a Forge window. It preloads a small demo room instead of reading from `localStorage`. Leaving the mode and coming back restores the map (`getState`/`setState`).
:::

## Painting a map

The grid starts at 40×25 cells. Click a swatch in the palette to select a tile type, then click-and-drag on the canvas to paint:

| Character | Tile | Character | Tile |
|---|---|---|---|
| `W` | Wall | `I` | Item |
| `G` | Wall 2 | `l` | Torch |
| `+` | Door | `T` | Lava |
| `O` | Secret | `~` | Slime |
| `P` | Player | `.` | Empty |
| `E` | Enemy | | |
| `b` | Barrel | | |

Further controls:

- **Resize** — set new `W`/`H` values and click Resize; existing content is preserved (anchored top-left), the new area is filled with Empty.
- **Bucket Fill (Empty)** — despite the name, not a flood-fill from a click point. It replaces *every* Empty cell (`.`) across the entire grid with the currently selected tile — useful for laying down a base floor before detailing.
- **Clear Map** — resets every cell to Empty; the button asks for a second click within a few seconds ("Wirklich löschen? (nochmal klicken)") instead of a blocking dialog.
- **Export** — the "Map kopieren" button copies the map to the clipboard as a newline-separated character grid, one character per cell.
- **Import** — a Universal IO dropzone ("Map, Level, Bild oder Text ablegen") accepts `.txt`, `.map`, `.json`, `.png`, `.zip`, a URL or `Cmd/Ctrl+V`. Images are quantized to a grid (`quantizeImageToGrid` in `core/map.ts`; images up to 128×128 keep their size).

There are no keyboard shortcuts — painting is entirely mouse-driven — and no undo/redo.

## Exporting into a game

Click **▶ Play in YAD** to save the current map to `localStorage` (key `yad_custom_map`) and open the [YAD](/guides/custom-game) showcase in a new tab, which reads that key on startup and uses it instead of its bundled default level. This is the only code path that writes that key; YAD reads it back, and `attachDevTools` loads it into the docked Map Generator on startup.

::: warning Map Generator's palette and YAD's legend don't fully line up
YAD's actual level legend uses `1`/`2`/`3` for health/armor/weapon items — it never reads `I`. And although YAD configures `lavaFloorChars: ["T"]`, its legend has no `T` entry, so a `T` tile painted here currently falls back to normal floor in YAD instead of rendering as lava. If you're building a level specifically for YAD, treat the editor's palette as a starting point, not a guaranteed 1:1 mapping — check YAD's legend in `apps/sample-apps/yad/App.ts`'s `setupScene()` to see what's actually rendered.
:::

## Using the exported string yourself

The export format is deliberately generic — it's simply lines of characters, one per grid cell — and is consumed by `GridLevelBuilder.build(scene, mapString, config)`, which you configure with your own `legend: Record<char, GridLegendEntry>` mapping that maps each character to a `"block"`, `"floor"`, `"sprite"`, or `"custom"` tile definition. Map Generator knows nothing about your game's specific tile semantics — that mapping is entirely up to you when you call `GridLevelBuilder` yourself. See YAD's `LevelBuilder` (`apps/sample-apps/yad/core/LevelBuilder.ts`) for a worked example of layering game-specific meaning (AI-capable enemies, animated doors, bobbing item pickups) on top of the base grid builder.

## Limitations

- **No procedural generation** — despite the class name, a manual painter.
- **"Bucket Fill" is a whole-grid replace, not a flood-fill** from the clicked cell.
- **No undo/redo**, no keyboard shortcuts, no multi-cell selection or line/rectangle tools.
- **Import/export asymmetry**: import trims whitespace from *both* ends of each line, while `GridLevelBuilder` only trims trailing whitespace — leading-space "indentation" tricks supported by the builder don't survive a round trip through Import String.
- **No size limits or validation** on the resize inputs — very large width/height values can hang the browser while building the canvas.
- Map data is unversioned in `localStorage` — once you've played a custom map in YAD, it remains the active level indefinitely (overriding the bundled level) until manually cleared.
