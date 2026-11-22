import {
  ShowcaseDrawer,
  hudNote,
  hudSection,
  hudSlider,
  hudSwitch,
} from "../shared/ShowcaseDrawer.js";
import type { WaterQuadtreeStats } from "@small-world-machine/engine";

export interface HudHost {
  quadtreeActive: boolean;
  quadtreeWireframe: boolean;
  quadtreeMaxLevel: number;
  quadtreeSegments: number;
  quadtreeDistanceFactor: number;
  getQuadtreeStats(): WaterQuadtreeStats | undefined;
  setQuadtreeActive(active: boolean): void;
  setQuadtreeWireframe(wireframe: boolean): void;
  setQuadtreeMaxLevel(level: number): void;
  setQuadtreeSegments(segments: number): void;
  setQuadtreeDistanceFactor(factor: number): void;
}

export class Hud {
  private readonly _drawer: ShowcaseDrawer;
  private readonly _host: HudHost;

  constructor(host: HudHost) {
    this._host = host;

    const body = `
      ${hudSection(
        "🌊 CDLOD Water Quadtree",
        "Q / W",
        `
        ${hudSwitch("quadtree-toggle", "Continuous Quadtree Mesh")}
        ${hudSwitch("quadtree-wireframe", "Wireframe / Tile Variants")}
        ${hudSlider("quadtree-max-level", "Max Subdivision Level", 0, 8, 1)}
        ${hudSlider("quadtree-segments", "Tile Segments", 4, 32, 2)}
        ${hudSlider("quadtree-distance-factor", "LOD Distance Factor", 1.2, 5.0, 0.1)}
        `,
      )}
      ${hudSection(
        "📊 CDLOD Telemetry",
        "Live",
        `
        <div id="quadtree-telemetry" style="font-family: var(--font-mono, monospace); font-size: 11px; line-height: 1.6; color: #7dd3fc;">
          Status: Quadtree inactive (gallery pools)
        </div>
        `,
      )}
      ${hudNote(
        "16 watertight CDLOD boundary tiles refine water resolution adaptively around the camera. Press Q to toggle quadtree ocean, W for wireframe.",
      )}
    `;

    this._drawer = new ShowcaseDrawer({
      id: "waterworld-hud",
      title: "Waterworld Lab",
      icon: "🌊",
      body,
      open: false,
      toggleKeys: ["KeyI"],
    });

    this._bindControls();
    this._initControlValues();
  }

  public handleKey(code: string): boolean {
    if (code === "KeyQ") {
      const next = !this._host.quadtreeActive;
      this._host.setQuadtreeActive(next);
      this._syncToggle("quadtree-toggle", next);
      return true;
    }
    if (code === "KeyW") {
      const next = !this._host.quadtreeWireframe;
      this._host.setQuadtreeWireframe(next);
      this._syncToggle("quadtree-wireframe", next);
      return true;
    }
    return false;
  }

  public update(): void {
    const el = document.getElementById("quadtree-telemetry");
    if (!el) return;

    if (!this._host.quadtreeActive) {
      el.textContent = "Status: Quadtree inactive (standard gallery pools)";
      return;
    }

    const stats = this._host.getQuadtreeStats();
    if (!stats) {
      el.textContent = "Status: Quadtree active (initializing...)";
      return;
    }

    el.innerHTML = `
      Active Leaves: <strong>${stats.activeLeafCount}</strong><br/>
      Triangles: <strong>${stats.activeTriangleCount.toLocaleString()}</strong><br/>
      Snapped Origin: <strong>[${stats.originX.toFixed(1)}, ${stats.originZ.toFixed(1)}]</strong>
    `;
  }

  public dispose(): void {
    this._drawer.dispose();
  }

  private _initControlValues(): void {
    this._syncToggle("quadtree-toggle", this._host.quadtreeActive);
    this._syncToggle("quadtree-wireframe", this._host.quadtreeWireframe);
    this._syncSlider(
      "quadtree-max-level",
      this._host.quadtreeMaxLevel,
      `${this._host.quadtreeMaxLevel}`,
    );
    this._syncSlider(
      "quadtree-segments",
      this._host.quadtreeSegments,
      `${this._host.quadtreeSegments}×${this._host.quadtreeSegments}`,
    );
    this._syncSlider(
      "quadtree-distance-factor",
      this._host.quadtreeDistanceFactor,
      `${this._host.quadtreeDistanceFactor.toFixed(1)}×`,
    );
  }

  private _bindControls(): void {
    const toggle = document.getElementById("quadtree-toggle") as HTMLInputElement | null;
    toggle?.addEventListener("change", () => {
      this._host.setQuadtreeActive(toggle.checked);
    });

    const wire = document.getElementById("quadtree-wireframe") as HTMLInputElement | null;
    wire?.addEventListener("change", () => {
      this._host.setQuadtreeWireframe(wire.checked);
    });

    const level = document.getElementById("quadtree-max-level") as HTMLInputElement | null;
    level?.addEventListener("input", () => {
      const v = Number(level.value);
      this._setValLabel("quadtree-max-level", `${v}`);
      this._host.setQuadtreeMaxLevel(v);
    });

    const segs = document.getElementById("quadtree-segments") as HTMLInputElement | null;
    segs?.addEventListener("input", () => {
      let val = Number(segs.value);
      if (val % 2 !== 0) val += 1;
      this._setValLabel("quadtree-segments", `${val}×${val}`);
      this._host.setQuadtreeSegments(val);
    });

    const dist = document.getElementById("quadtree-distance-factor") as HTMLInputElement | null;
    dist?.addEventListener("input", () => {
      const v = Number(dist.value);
      this._setValLabel("quadtree-distance-factor", `${v.toFixed(1)}×`);
      this._host.setQuadtreeDistanceFactor(v);
    });
  }

  private _syncToggle(id: string, val: boolean): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.checked = val;
  }

  private _syncSlider(id: string, val: number, label: string): void {
    const input = document.getElementById(id) as HTMLInputElement | null;
    if (input) input.value = String(val);
    this._setValLabel(id, label);
  }

  private _setValLabel(id: string, text: string): void {
    const el = document.getElementById(`${id}_val`);
    if (el) el.textContent = text;
  }
}
