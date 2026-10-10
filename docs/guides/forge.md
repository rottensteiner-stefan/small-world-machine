# The Forge (in-game tooling)

Building assets (textures, sprite sheets, level maps) often forces developers to constantly switch between the game engine and external software like Photoshop or Tiled.

**The Forge** solves this by providing an extensible window manager and tool framework directly in the game. With the Forge, mini-applications can run directly on top of the game canvas.

## What is the Forge?

The `Forge` class is an overlay that hosts draggable, resizable windows containing `ForgeTool` instances. It can be shown/hidden with a keyboard shortcut (e.g. `F12` or `~`) without leaving the browser.

## Built-in tools

Small World Machine ships with several built-in Forge tools to speed up your workflow:

1. **[Pixler](/guides/pixler):** A retro 2D pixel-art editor for drawing sprites directly in-game. Offers a full UI toolbar with pencil, bucket fill, color picker, and line tool. Supports symmetry mode (X/Y axis), automatic edge trimming, canvas panning, mirroring, and full undo/redo history.
2. **[Xtractor](/guides/xtractor):** An image cropping/slicing tool that can hand crops directly to Pixler. Includes a mock AI-assistant UI as a starting point for integrating a real vision-model backend.
3. **[Map Generator](/guides/map-generator):** A visual grid editor for painting generic maps/levels and exporting them as `GridLevelBuilder`-compatible ASCII strings.
4. **[Maker](/guides/maker):** A standalone 3D world and scene editor with glTF 2.0 + `SW_*` persistence, transform gizmos, snapping, prefabs, and full undo/redo.
5. **[Material Studio](/guides/material-studio):** A PBR texture map generator that derives normal/roughness/AO/etc. maps from a single diffuse image and previews them on a sample mesh.

::: tip Standalone tool pages
Maker, Pixler, Xtractor, and Map Generator are also available as **standalone web pages** (`/tools/maker.html`, `/tools/pixler.html`, `/tools/map-gen.html`, `/tools/xtractor.html`) that run independently, without needing a game canvas or Forge overlay — the recommended path for a dedicated asset-editing workflow. Material Studio is available docked in the Forge overlay of a running engine, or as a standalone generator tool.
:::

::: tip Own package since ADR 0024
`Forge`, `ForgeTool`, and every built-in tool live, since [ADR 0024](/adr/0024-tools-ecosystem-package), in their own resolvable workspace package, `@small-world-machine/tools` (`packages/tools/`) — no longer in `@small-world-machine/engine`. Only `ForgeTool` (the interface) remains in the core.
:::

## Integrating the Forge into your own app

::: tip The quick path: `attachDevTools`
None of this needs to be wired up by hand. `attachDevTools(app)` from `@small-world-machine/tools` automatically creates a Forge hub with all four built-in window tools already docked — Map Generator, Pixler, Xtractor, and Material Studio — bound to **Ctrl+Alt+G** (Cmd+Alt+G on macOS) to show/hide. It replaces the former `enableInspector: true` (removed in ADR 0024, since otherwise the core would need to know about concrete tool classes). See each tool's own guide for what it does. The manual setup below is meant for building your **own** tools, or if you want a different subset of windows.

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const app = new MyGame();
attachDevTools(app);
app.start();
```
:::

To dock your own `ForgeTool`s (or a hand-picked subset of the built-in ones), initialize a `Forge` yourself and open windows directly on it. Note that `Xtractor` *requires* an `EventDispatcherImpl` as its first constructor parameter (used to hand crops off to Pixler), and `Pixler` optionally accepts one (to receive that hand-off) — pass the `SmallWorldMachine` instance's own `events` bus to both so they can talk to each other:

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { Forge, Pixler, Xtractor, MapGenerator } from "@small-world-machine/tools";

class MyGame extends SmallWorldMachine {
  public readonly myForge: Forge;

  constructor() {
    super();

    // 1. Initialize the Forge overlay and bind it to the '~' key
    this.myForge = new Forge({ toggleKey: "~" });

    // 2. Open tools in floating windows, sharing `this.events` so Xtractor can hand crops off to Pixler
    this.myForge.openWindow("Pixler Editor", new Pixler(this.events), 50, 50);
    this.myForge.openWindow("Map Generator", new MapGenerator(), 400, 50);
    this.myForge.openWindow("Asset Extractor", new Xtractor(this.events), 50, 400);
  }
}
```

When the game starts and `~` is pressed, a semi-transparent overlay appears with the docked tools. Sprites can be drawn in Pixler, copied to the clipboard, and pasted directly into the game's asset configurations.

## Building your own tools

You can build your own `ForgeTool` to edit specific parts of your own game logic (e.g. a dialogue editor, a quest tracker).

```typescript
import { ForgeTool, ForgeToolOptions } from "@small-world-machine/engine";

export class MyCustomTool extends ForgeTool {
  constructor(options: ForgeToolOptions = {}) {
    super(options);
    
    // Build the tool's HTML UI inside this._container
    this._container.innerHTML = `
      <div style="padding: 10px; color: white;">
        <h3>My Tool</h3>
        <button id="my-btn">Click Me!</button>
      </div>
    `;

    this._container.querySelector("#my-btn")?.addEventListener("click", () => {
      console.log("Custom tool logic executed!");
    });
  }
}
```

Then simply inject it:
```typescript
this.forge.openWindow("My Tool", new MyCustomTool(), 100, 100);
```
