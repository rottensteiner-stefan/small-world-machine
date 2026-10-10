/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { HotspotManager, HotspotAction } from "../ui/HotspotManager.js";
import { Vector3D } from "@small-world-machine/engine";

describe("HotspotManager", () => {
  let manager: HotspotManager;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="interactionPrompt" style="display: none;">
        <span id="promptText"></span>
      </div>
      <div id="monologueBox" style="display: none;">
        <div id="monologueTitle"></div>
        <div id="monologueBody"></div>
        <div id="monologueFooter"></div>
      </div>
    `;
    manager = new HotspotManager();
  });

  it("registers and detects closest hotspot within radius", () => {
    const spot: HotspotAction = {
      id: "grinder",
      name: "Kaffeemühle",
      position: new Vector3D(-0.5, 0, -1.0),
      interactionRadius: 1.5,
      promptText: "Kaffeemühle untersuchen",
      monologueTitle: "Františeks Kaffeemühle",
      monologueText: ["Eine alte Kaffeemühle.", "Hier ist ein Geheimfach."],
    };

    manager.registerHotspot(spot);

    // Player far away
    manager.update(new Vector3D(5, 0, 5));
    expect(manager.activeHotspot).toBeNull();

    // Player walks near
    manager.update(new Vector3D(-0.4, 0, -0.8));
    expect(manager.activeHotspot?.id).toBe("grinder");
    const prompt = document.getElementById("interactionPrompt");
    expect(prompt?.style.display).toBe("flex");
  });

  it("handles multi-page monologue advancement and closing", () => {
    let interacted = false;
    const spot: HotspotAction = {
      id: "shelf",
      name: "Regal",
      position: new Vector3D(0, 0, 0),
      interactionRadius: 2.0,
      promptText: "Regal prüfen",
      monologueTitle: "Holzregal",
      monologueText: ["Seite 1 Text", "Seite 2 Text"],
      onInteract: () => {
        interacted = true;
      },
    };

    manager.registerHotspot(spot);
    manager.update(new Vector3D(0.2, 0, 0.1));

    // Interact to open monologue
    const handled = manager.interact();
    expect(handled).toBe(true);
    expect(interacted).toBe(true);
    expect(manager.isMonologueOpen).toBe(true);

    const body = document.getElementById("monologueBody");
    expect(body?.innerText).toBe("Seite 1 Text");

    // Advance to page 2
    manager.advanceMonologue();
    expect(manager.isMonologueOpen).toBe(true);
    expect(body?.innerText).toBe("Seite 2 Text");

    // Advance past end -> closes
    manager.advanceMonologue();
    expect(manager.isMonologueOpen).toBe(false);
    const box = document.getElementById("monologueBox");
    expect(box?.style.display).toBe("none");
  });
});
