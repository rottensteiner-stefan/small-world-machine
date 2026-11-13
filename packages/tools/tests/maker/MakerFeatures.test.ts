// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Object3D, PointLight, DirectionalLight, SpotLight } from "@small-world-machine/engine";
import { TransformGizmo } from "../../src/maker/TransformGizmo.js";
import { OrbitCameraController } from "../../src/maker/OrbitCameraController.js";
import { HierarchyPanel } from "../../src/maker/HierarchyPanel.js";
import { LightGizmoManager } from "../../src/maker/LightGizmoManager.js";

describe("Maker Phase 2 Features", () => {
  describe("Grid & Angle Snapping", () => {
    it("snaps translate to configured grid intervals", () => {
      const gizmo = new TransformGizmo();
      gizmo.snap.enabled = true;
      gizmo.snap.translate = 0.5;

      expect(gizmo.snapValue("translate", 0.0)).toBeCloseTo(0.0);
      expect(gizmo.snapValue("translate", 0.24)).toBeCloseTo(0.0);
      expect(gizmo.snapValue("translate", 0.26)).toBeCloseTo(0.5);
      expect(gizmo.snapValue("translate", 1.8)).toBeCloseTo(2.0);
      expect(gizmo.snapValue("translate", -0.74)).toBeCloseTo(-0.5);
      expect(gizmo.snapValue("translate", -0.76)).toBeCloseTo(-1.0);
    });

    it("snaps rotate to configured angle intervals (e.g. 15 degrees / PI/12)", () => {
      const gizmo = new TransformGizmo();
      gizmo.snap.enabled = true;
      gizmo.snap.rotate = Math.PI / 12; // 15 deg

      const deg15 = Math.PI / 12;
      expect(gizmo.snapValue("rotate", deg15 * 0.4)).toBeCloseTo(0);
      expect(gizmo.snapValue("rotate", deg15 * 0.6)).toBeCloseTo(deg15);
      expect(gizmo.snapValue("rotate", deg15 * 5.9)).toBeCloseTo(deg15 * 6); // 90 deg
    });

    it("snaps scale and enforces minimum scale of 0.01", () => {
      const gizmo = new TransformGizmo();
      gizmo.snap.enabled = true;
      gizmo.snap.scale = 0.25;

      expect(gizmo.snapValue("scale", 1.1)).toBeCloseTo(1.0);
      expect(gizmo.snapValue("scale", 1.2)).toBeCloseTo(1.25);
      expect(gizmo.snapValue("scale", -0.5)).toBeCloseTo(0.01);
      expect(gizmo.snapValue("scale", 0.0)).toBeCloseTo(0.01);
    });
  });

  describe("OrbitCameraController Drag & Zoom", () => {
    it("updates yaw and pitch correctly via rotate()", () => {
      const orbit = new OrbitCameraController({ distance: 10, yaw: 0, pitch: 0 });
      orbit.rotate(100, 50);

      const view = orbit.getView();
      expect(view.yaw).toBeCloseTo(-100 * 0.005);
      expect(view.pitch).toBeCloseTo(-50 * 0.005);
    });

    it("updates distance via zoom()", () => {
      const orbit = new OrbitCameraController({ distance: 10 });
      orbit.zoom(20);
      const view = orbit.getView();
      expect(view.distance).toBeGreaterThan(10);
    });
  });

  describe("Gizmo Always-on-Top & Nudge", () => {
    it("configures gizmo handle materials with depthTest and depthWrite false", () => {
      const gizmo = new TransformGizmo();
      const leaves: Object3D[] = [];
      const collect = (node: Object3D): void => {
        if (node.material) leaves.push(node);
        for (const c of node.children) collect(c);
      };
      collect(gizmo.root);

      expect(leaves.length).toBeGreaterThan(0);
      for (const leaf of leaves) {
        expect(leaf.material?.depthTest).toBe(false);
        expect(leaf.material?.depthWrite).toBe(false);
      }
    });

    it("cycles grid snap steps with stepGrid()", () => {
      const gizmo = new TransformGizmo();
      expect(gizmo.snap.translate).toBe(0.5);

      // Step up: 0.5 -> 1.0 -> 2.0 -> 2.0 (clamp)
      expect(gizmo.stepGrid(1)).toBe(1.0);
      expect(gizmo.stepGrid(1)).toBe(2.0);
      expect(gizmo.stepGrid(1)).toBe(2.0);

      // Step down: 2.0 -> 1.0 -> 0.5 -> 0.25 -> 0.1 -> 0.1 (clamp)
      expect(gizmo.stepGrid(-1)).toBe(1.0);
      expect(gizmo.stepGrid(-1)).toBe(0.5);
      expect(gizmo.stepGrid(-1)).toBe(0.25);
      expect(gizmo.stepGrid(-1)).toBe(0.1);
      expect(gizmo.stepGrid(-1)).toBe(0.1);
    });
  });

  describe("Object Renaming (Hierarchy & PropertyPanel)", () => {
    it("renders inline rename input on startRenaming() in HierarchyPanel and commits on Enter", () => {
      const container = document.createElement("div");
      const root = new Object3D("Root");
      const child = new Object3D("OldName");
      root.add(child);

      let renamed: { obj: Object3D; name: string } | null = null;
      const hierarchy = new HierarchyPanel(container, () => root, {
        onSelect: (): void => {},
        onReparent: (): void => {},
        onRename: (obj, name): void => {
          renamed = { obj, name };
        },
      });

      hierarchy.refresh();
      expect(container.querySelector(".maker-hierarchy-row")?.textContent).toBe("OldName");

      // Start inline renaming
      hierarchy.startRenaming(child);
      const input = container.querySelector(".maker-hierarchy-rename-input") as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.value).toBe("OldName");

      // Change value and press Enter
      input.value = "NewAwesomeName";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(renamed).toEqual({ obj: child, name: "NewAwesomeName" });
    });

    it("cancels inline rename on Escape without invoking onRename", () => {
      const container = document.createElement("div");
      const root = new Object3D("Root");
      const child = new Object3D("KeepMe");
      root.add(child);

      let renamed = false;
      const hierarchy = new HierarchyPanel(container, () => root, {
        onSelect: (): void => {},
        onReparent: (): void => {},
        onRename: (): void => {
          renamed = true;
        },
      });

      hierarchy.startRenaming(child);
      const input = container.querySelector(".maker-hierarchy-rename-input") as HTMLInputElement;
      input.value = "DiscardedName";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

      expect(renamed).toBe(false);
      expect(container.querySelector(".maker-hierarchy-row")?.textContent).toBe("KeepMe");
    });

    it("filters hierarchy tree in real time and selects first match on Enter", () => {
      const container = document.createElement("div");
      const root = new Object3D("Root");
      const barrelA = new Object3D("Oil_Barrel_01");
      const barrelB = new Object3D("Oil_Barrel_02");
      const crate = new Object3D("Wood_Crate");
      root.add(barrelA);
      root.add(barrelB);
      root.add(crate);

      let selectedObj: Object3D | null = null;
      const hierarchy = new HierarchyPanel(container, () => root, {
        onSelect: (obj): void => {
          selectedObj = obj;
        },
        onReparent: (): void => {},
      });

      hierarchy.refresh();
      const allRows = container.querySelectorAll(".maker-hierarchy-row");
      expect(allRows.length).toBe(3);

      const searchInput = container.querySelector(
        ".maker-hierarchy-search-input",
      ) as HTMLInputElement;
      expect(searchInput).not.toBeNull();

      // Type "barrel" into search
      searchInput.value = "barrel";
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));

      const filteredRows = container.querySelectorAll(".maker-hierarchy-row");
      expect(filteredRows.length).toBe(2);
      expect(filteredRows[0]?.textContent).toBe("Oil_Barrel_01");
      expect(filteredRows[1]?.textContent).toBe("Oil_Barrel_02");

      // Press Enter to select first match
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(selectedObj).toBe(barrelA);

      // Press Escape to clear filter and reset
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(searchInput.value).toBe("");
      expect(container.querySelectorAll(".maker-hierarchy-row").length).toBe(3);
    });
  });

  describe("LightGizmoManager (3D Light Markers & Selection Bounds)", () => {
    it("creates, updates, and picks visual markers and selection ranges for lights", () => {
      const mgr = new LightGizmoManager();
      const sceneRoot = new Object3D("SceneRoot");

      const pointLight = new PointLight({ name: "BunkerLamp", distance: 12 });
      pointLight.position.set(2, 3, 4);
      sceneRoot.add(pointLight);

      const spotLight = new SpotLight({ name: "Flashlight", distance: 15, angle: 0.5 });
      spotLight.position.set(0, 5, 0);
      sceneRoot.add(spotLight);

      const sunLight = new DirectionalLight({ name: "Sun" });
      sceneRoot.add(sunLight);

      // 1. Initial update (unselected)
      mgr.update(sceneRoot, new Set(), true);
      expect(mgr.root.children.length).toBeGreaterThanOrEqual(3);

      // Collect pickables
      const pickables: Object3D[] = [];
      mgr.collectPickables(pickables);
      expect(pickables.length).toBe(3);

      // Verify picking resolution
      const pointMarker = pickables.find((p) => p.name === "Helper_BunkerLamp");
      expect(pointMarker).toBeDefined();
      expect(mgr.getLightForObject(pointMarker!)).toBe(pointLight);

      // 2. Selection update (point light selected; hierarchy unchanged, reuses cached lights)
      mgr.update(sceneRoot, new Set([pointLight]), false);
      const rangeGizmo = mgr.root.children.find((c) => c.name === "Range_BunkerLamp");
      expect(rangeGizmo).toBeDefined();
      expect(rangeGizmo?.isVisible).toBe(true);

      // 3. Deletion sync (hierarchy changed -> forces a fresh scene walk)
      sceneRoot.remove(pointLight);
      mgr.update(sceneRoot, new Set(), true);
      const afterPickables: Object3D[] = [];
      mgr.collectPickables(afterPickables);
      expect(afterPickables.find((p) => p.name === "Helper_BunkerLamp")).toBeUndefined();
    });

    it("skips the full scene walk when hierarchyChanged is false, reusing the cached light set", () => {
      const mgr = new LightGizmoManager();
      const sceneRoot = new Object3D("SceneRoot");

      const sunLight = new DirectionalLight({ name: "Sun" });
      sceneRoot.add(sunLight);
      mgr.update(sceneRoot, new Set(), true);

      const initialPickables: Object3D[] = [];
      mgr.collectPickables(initialPickables);
      expect(initialPickables.length).toBe(1);

      // A newly added light must not be discovered while hierarchyChanged stays false --
      // the manager should keep reusing its cached light set instead of re-walking the scene.
      const newLamp = new PointLight({ name: "LateLamp" });
      sceneRoot.add(newLamp);
      mgr.update(sceneRoot, new Set(), false);

      const stillCachedPickables: Object3D[] = [];
      mgr.collectPickables(stillCachedPickables);
      expect(stillCachedPickables.length).toBe(1);
      expect(stillCachedPickables.find((p) => p.name === "Helper_LateLamp")).toBeUndefined();

      // Once the caller reports a hierarchy change, the new light is picked up.
      mgr.update(sceneRoot, new Set(), true);
      const finalPickables: Object3D[] = [];
      mgr.collectPickables(finalPickables);
      expect(finalPickables.length).toBe(2);
      expect(finalPickables.find((p) => p.name === "Helper_LateLamp")).toBeDefined();
    });
  });
});
