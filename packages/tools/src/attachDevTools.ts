import { SmallWorldMachine } from "@small-world-machine/engine";
import { Forge } from "./forge/Forge.js";
import { MapGenerator } from "./MapGenerator.js";
import { Pixler } from "./Pixler.js";
import { Xtractor } from "./Xtractor.js";
import { MaterialStudio } from "./MaterialStudio.js";

export interface DevToolsHandle {
  readonly forge: Forge;
  detach(): void;
}

/**
 * Wires the Forge window manager and the standard tool suite (Map Generator, Pixler, Xtractor,
 * Material Studio) into a running `SmallWorldMachine` app, and registers the Alt+Ctrl/Meta+G hotkey to
 * toggle Forge's visibility. This used to be hardcoded inside `SmallWorldMachine`'s `enableInspector`
 * handling; apps that want the in-game dev overlay now call this explicitly instead (ADR 0024),
 * so the engine core never depends on a concrete tool implementation.
 */
export function attachDevTools(app: SmallWorldMachine): DevToolsHandle {
  const forge = new Forge();

  const mapGen = new MapGenerator();
  const savedMap = localStorage.getItem("yad_custom_map");
  if (savedMap) {
    mapGen.loadMapString(savedMap);
  }
  forge.openWindow("Map Generator", mapGen, 60, 60, "mapGenerator");
  forge.openWindow("Pixler Editor", new Pixler(app.events), 50, 200, "pixlerEditor");
  forge.openWindow("Asset Extractor", new Xtractor(app.events), 400, 60, "assetExtractor");
  forge.openWindow("Material Studio", new MaterialStudio(), 750, 60, "materialStudio");

  const onKeyDown = (event: KeyboardEvent): void => {
    if (
      document.activeElement &&
      ("INPUT" === document.activeElement.tagName || "TEXTAREA" === document.activeElement.tagName)
    ) {
      return;
    }
    if (true === event.repeat) return;

    const altLeft = app.input.isPressed("AltLeft") || event.altKey;
    const metaLeft = app.input.isPressed("MetaLeft") || event.metaKey;
    const ctrlLeft = app.input.isPressed("ControlLeft") || event.ctrlKey;

    if (true === altLeft && (true === metaLeft || true === ctrlLeft) && "KeyG" === event.code) {
      event.preventDefault();
      forge.toggle();

      if (forge.isVisible) {
        app.input.preventPointerLock = true;
        if (null !== document.pointerLockElement) {
          document.exitPointerLock();
        }
      } else {
        app.input.preventPointerLock = false;
      }
    }
  };

  window.addEventListener("keydown", onKeyDown);

  return {
    forge,
    detach(): void {
      window.removeEventListener("keydown", onKeyDown);
      forge.destroy();
    },
  };
}
