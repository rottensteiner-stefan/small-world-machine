// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Object3D, Vector3D } from "@small-world-machine/engine";
import type {
  ContentDrawerCallbacks,
  StudioPbrMaterialData,
} from "../../src/maker/ContentDrawer.js";
import { ContentDrawer } from "../../src/maker/ContentDrawer.js";

/** Scripted Material-Studio payload for the drawer tests (real canvases, jsdom supports 2D). */
function makeMaterial(overrides?: Partial<StudioPbrMaterialData>): StudioPbrMaterialData {
  const canvas = (): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    return c;
  };
  return {
    name: "Rust",
    diffuseMap: canvas(),
    normalMap: canvas(),
    roughnessMap: canvas(),
    normalStrength: 1,
    metallic: 0.2,
    roughness: 0.5,
    ...overrides,
  };
}

describe("ContentDrawer (Unreal Content Browser in Maker)", () => {
  let container: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let callbacks: ContentDrawerCallbacks;

  beforeEach(() => {
    container = document.createElement("div");
    canvas = document.createElement("canvas");
    document.body.appendChild(container);
    document.body.appendChild(canvas);

    callbacks = {
      loadKitProp: vi.fn().mockResolvedValue(new Object3D("MockProp")),
      createPrimitive: vi.fn((factory) => factory()),
      applyTexture: vi.fn().mockResolvedValue(undefined),
      applyMaterial: vi.fn(),
      createDecal: vi.fn().mockResolvedValue(undefined),
      instantiatePrefab: vi.fn().mockResolvedValue(undefined),
      getRaycastHit: vi
        .fn()
        .mockReturnValue({ position: new Vector3D(1, 0, 2), targetObject: undefined }),
      getGroundPosition: vi.fn().mockReturnValue(new Vector3D(1, 0, 2)),
    };
  });

  it("constructs DOM hierarchy with toggle bar, breadcrumbs, search, tree, and grid", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });

    expect(container.querySelector(".maker-content-drawer-wrapper")).not.toBeNull();
    expect(container.querySelector(".maker-content-toggle-btn")).not.toBeNull();
    expect(container.querySelector(".maker-content-breadcrumbs")).not.toBeNull();
    expect(container.querySelector(".maker-content-search-input")).not.toBeNull();
    expect(container.querySelector(".maker-content-tree-pane")).not.toBeNull();
    expect(container.querySelector(".maker-content-grid-pane")).not.toBeNull();
    expect(drawer.isOpen).toBe(false);
  });

  it("toggles open and closed via method and toggle button", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    const toggleBtn = container.querySelector(".maker-content-toggle-btn") as HTMLButtonElement;

    expect(drawer.isOpen).toBe(false);
    toggleBtn.click();
    expect(drawer.isOpen).toBe(true);
    expect(
      container.querySelector(".maker-content-drawer-wrapper")?.classList.contains("open"),
    ).toBe(true);

    drawer.close();
    expect(drawer.isOpen).toBe(false);
    expect(
      container.querySelector(".maker-content-drawer-wrapper")?.classList.contains("open"),
    ).toBe(false);
  });

  it("opens drawer on Ctrl+Space shortcut", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });

    expect(drawer.isOpen).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { ctrlKey: true, code: "Space" }));
    expect(drawer.isOpen).toBe(true);
  });

  it("renders primitive assets and allows double-click instantiation", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    drawer.open();

    const cubeCard = Array.from(container.querySelectorAll(".maker-asset-card")).find((c) =>
      c.textContent?.includes("Cube"),
    ) as HTMLElement;

    expect(cubeCard).toBeDefined();
    cubeCard.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(callbacks.createPrimitive).toHaveBeenCalled();
  });

  it("supports prefab refresh and filtering", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    drawer.open();

    drawer.refreshPrefabs([{ name: "CustomTable", thumbnailDataUrl: "data:image/png;base64,123" }]);

    const prefabCard = Array.from(container.querySelectorAll(".maker-asset-card")).find((c) =>
      c.textContent?.includes("CustomTable"),
    );
    expect(prefabCard).toBeDefined();
  });

  interface MockDropEvent extends Event {
    clientX: number;
    clientY: number;
    dataTransfer: {
      getData: (type: string) => string;
    };
  }

  it("handles drag and drop from Content Drawer onto canvas with raycast hit", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    drawer.open();

    const mockAsset = {
      id: "primitive/cube",
      name: "Cube",
      type: "primitive",
      folderPath: "Primitives/3D",
      factory: (): Object3D => new Object3D("Cube"),
    };

    const dragData = JSON.stringify(mockAsset);
    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as unknown as MockDropEvent;
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;
    dropEvent.dataTransfer = {
      getData: (type: string): string =>
        type === "application/x-smallworldmachine-asset" ? dragData : "",
    };

    canvas.dispatchEvent(dropEvent);
    expect(callbacks.getRaycastHit).toHaveBeenCalledWith(100, 100);
    expect(callbacks.createPrimitive).toHaveBeenCalled();
    // Should auto-dismiss when unpinned
    expect(drawer.isOpen).toBe(false);
  });

  it("handles texture drag and drop onto target mesh", () => {
    const targetMesh = new Object3D("TargetCube");
    callbacks.getRaycastHit = vi.fn().mockReturnValue({
      position: new Vector3D(0, 0, 0),
      targetObject: targetMesh,
    });

    new ContentDrawer({ container, canvas, callbacks });

    const mockTexAsset = {
      id: "brick_aged",
      name: "Aged Brick",
      type: "texture",
      kitId: "flakturm",
      folderPath: "Kits/Flakturm/Materials",
      raw: { id: "brick_aged", maps: ["albedo.png"] },
    };

    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as unknown as MockDropEvent;
    dropEvent.clientX = 50;
    dropEvent.clientY = 50;
    dropEvent.dataTransfer = {
      getData: (type: string): string =>
        type === "application/x-smallworldmachine-asset" ? JSON.stringify(mockTexAsset) : "",
    };

    canvas.dispatchEvent(dropEvent);
    expect(callbacks.applyTexture).toHaveBeenCalledWith("flakturm", mockTexAsset.raw, targetMesh);
  });

  it("adds a captured studio material and applies it on double click", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    drawer.open();
    const material = makeMaterial();

    drawer.addMaterial(material);

    const card = Array.from(container.querySelectorAll(".maker-asset-card")).find((c) =>
      c.textContent?.includes("Rust"),
    ) as HTMLElement;
    expect(card).toBeDefined();
    expect(card.querySelector(".maker-asset-type-badge")?.textContent).toBe("MATERIAL");

    card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    // The LIVE payload (canvas references) is handed over, not a JSON clone.
    expect(callbacks.applyMaterial).toHaveBeenCalledWith(material);
  });

  it("upserts a re-sent material by name instead of piling up duplicates", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    drawer.addMaterial(makeMaterial({ name: "Rust", metallic: 0.1 }));
    drawer.addMaterial(makeMaterial({ name: "Rust", metallic: 0.9 }));

    const rustCards = Array.from(container.querySelectorAll(".maker-asset-card")).filter((c) =>
      c.textContent?.includes("Rust"),
    );
    expect(rustCards.length).toBe(1);
  });

  it("shows studio materials under the PBR Materials pill (same category as kit textures)", () => {
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    drawer.addMaterial(makeMaterial({ name: "Granite" }));
    drawer.open();

    const pill = Array.from(container.querySelectorAll(".maker-filter-pill")).find((p) =>
      p.textContent?.includes("PBR Materials"),
    ) as HTMLElement;
    expect(pill).toBeDefined();
    pill.click();

    const cards = Array.from(container.querySelectorAll(".maker-asset-card"));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.textContent).toContain("Granite");
    }
  });

  it("resolves a dropped material against the LIVE in-memory entry by id (canvases do not survive JSON)", () => {
    const targetMesh = new Object3D("Target");
    callbacks.getRaycastHit = vi.fn().mockReturnValue({
      position: new Vector3D(0, 0, 0),
      targetObject: targetMesh,
    });
    const drawer = new ContentDrawer({ container, canvas, callbacks });
    const material = makeMaterial();
    drawer.addMaterial(material);
    drawer.open();

    // Real drag payload: JSON.stringify drops the canvas references -- only id+type survive.
    const dragData = JSON.stringify({ id: "material/rust", type: "material" });
    const dropEvent = new Event("drop", {
      bubbles: true,
      cancelable: true,
    }) as unknown as MockDropEvent;
    dropEvent.clientX = 60;
    dropEvent.clientY = 60;
    dropEvent.dataTransfer = {
      getData: (type: string): string =>
        type === "application/x-smallworldmachine-asset" ? dragData : "",
    };

    canvas.dispatchEvent(dropEvent);
    expect(callbacks.applyMaterial).toHaveBeenCalledWith(material, targetMesh);
    // Auto-dismiss when unpinned (UE5 drawer standard)
    expect(drawer.isOpen).toBe(false);
  });
});
