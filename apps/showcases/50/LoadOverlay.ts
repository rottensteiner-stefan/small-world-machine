import type { ChessProgress } from "./Pieces.js";

const PHASE_LABEL: Record<ChessProgress["phase"], string> = {
  download: "Streaming glTF from GitHub …",
  decode: "Decoding Draco + Basis Universal …",
  prepare: "Preparing pieces …",
};

/**
 * Full-screen loading overlay of Showcase 50 -- the engine's first public demonstration of a real
 * asset-load progress indicator. Shows the live byte-stream progress of
 * `AssetManager.streamBinary` on the remote 12 MB KTX-ETC1S-Draco chess set and then the compute
 * phases (WASM decode / scene prepare). The drawer is HUD-free during the load, and the overlay is
 * removed before the first rendered frame, so golden captures stay deterministic.
 */
export class LoadOverlay {
  private readonly _root: HTMLDivElement;
  private readonly _phase: HTMLElement;
  private readonly _barFill: HTMLElement;
  private readonly _barText: HTMLElement;
  private _hidden: boolean = false;

  constructor() {
    document.getElementById("swm50LoadOverlay")?.remove();
    const root = document.createElement("div");
    root.id = "swm50LoadOverlay";
    root.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:9999",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "background:rgba(2,6,17,0.88)",
      "font-family:var(--font-mono,'JetBrains Mono',monospace)",
      "color:#e2e8f0",
    ].join(";");

    root.innerHTML = `
      <div style="width:min(560px,84vw);background:rgba(13,20,36,0.92);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:22px 24px;box-shadow:0 18px 60px rgba(0,0,0,0.6);">
        <div style="font-size:15px;font-weight:700;letter-spacing:1.5px;margin-bottom:4px;">♞ SMALL WORLD MACHINE</div>
        <div style="font-size:12px;color:#7dd3fc;margin-bottom:16px;">Interactive Chess Set — remote asset streaming</div>

        <div id="swm50Phase" style="font-size:12px;color:#94a3b8;margin-bottom:8px;">Streaming glTF from GitHub …</div>

        <div style="height:14px;background:rgba(255,255,255,0.08);border-radius:7px;overflow:hidden;">
          <div id="swm50BarFill" style="height:100%;width:0%;background:linear-gradient(90deg,#22c55e,#38bdf8);transition:width 0.15s linear;"></div>
        </div>
        <div id="swm50BarText" style="font-size:11px;color:#a5f3fc;margin-top:6px;text-align:right;">0 %</div>

        <div id="swm50Facts" style="font-size:10px;color:#64748b;margin-top:14px;line-height:1.6;">
          <div>Source: <span style="color:#94a3b8;">Khronos glTF-Sample-Assets &middot; ABeautifulGame (glTF-Binary-KTX-ETC1S-Draco)</span></div>
          <div>Extensions: <span style="color:#94a3b8;">KHR_draco_mesh_compression + KHR_texture_basisu via the opt-in package</span></div>
          <div>License: <span style="color:#94a3b8;">CC-BY 4.0 (&copy; ASWF 2020 / Ed Mackey 2022)</span></div>
        </div>

        <div id="swm50LoadError" style="display:none;font-size:12px;color:#f87171;margin-top:10px;"></div>
      </div>
    `;
    document.body.appendChild(root);

    this._root = root;
    this._phase = root.querySelector<HTMLElement>("#swm50Phase")!;
    this._barFill = root.querySelector<HTMLElement>("#swm50BarFill")!;
    this._barText = root.querySelector<HTMLElement>("#swm50BarText")!;
  }

  public update(progress: ChessProgress): void {
    if (this._hidden) return;
    this._phase.textContent = PHASE_LABEL[progress.phase];
    const pct =
      progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
    this._barFill.style.width = `${pct}%`;
    const mb = (v: number): string => (v / 1048576).toFixed(1);
    this._barText.textContent =
      progress.total > 0
        ? `${pct} % — ${mb(progress.loaded)} / ${mb(progress.total)} MB`
        : "connecting …";
  }

  public fail(message: string): void {
    if (this._hidden) return;
    this._phase.textContent = "Load failed";
    this._barFill.style.background = "#ef4444";
    const error = this._root.querySelector<HTMLElement>("#swm50LoadError");
    if (error) {
      error.style.display = "block";
      error.textContent = message;
    }
  }

  public hide(): void {
    this._hidden = true;
    this._root.remove();
  }

  public dispose(): void {
    this._root.remove();
  }
}
