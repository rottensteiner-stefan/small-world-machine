import { Events } from "../Events.js";
import type { EventDispatcherImpl } from "@small-world-machine/engine/core/index.js";

/**
 * Minimal HUD: a live "time flow" bar (the direct feedback for the time-warp mechanic --
 * without it the player can't tell whether letting go actually slowed things down) and a
 * round-over overlay with a restart hint.
 */
export class Hud {
  private _container: HTMLDivElement;
  private _timeFlowFillEl: HTMLDivElement;
  private _overlayEl: HTMLDivElement;
  private _overlayTextEl: HTMLSpanElement;

  constructor(private events: EventDispatcherImpl) {
    if (!document.getElementById("lca-hud-style")) {
      const style = document.createElement("style");
      style.id = "lca-hud-style";
      style.textContent = `
        .lca-hud {
          position: absolute;
          inset: 0;
          pointer-events: none;
          font-family: var(--font-mono, "JetBrains Mono", "SF Mono", Consolas, monospace);
          z-index: 100;
        }
        .lca-time-flow {
          position: absolute;
          bottom: 18px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .lca-time-flow-label {
          color: rgba(211, 214, 234, 0.6);
          font-size: 11px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
        }
        .lca-time-flow-track {
          width: 220px;
          height: 6px;
          background: rgba(255, 255, 255, 0.12);
          border-radius: 3px;
          overflow: hidden;
        }
        .lca-time-flow-fill {
          height: 100%;
          width: 8%;
          background: rgba(120, 230, 255, 0.9);
          box-shadow: 0 0 10px rgba(120, 230, 255, 0.7);
          transition: background 0.2s ease;
        }
        .lca-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 14px;
          background: rgba(5, 5, 8, 0.6);
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .lca-overlay.visible {
          opacity: 1;
        }
        .lca-overlay-text {
          font-size: 42px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.95);
          text-shadow: 0 0 30px rgba(150, 220, 255, 0.8);
        }
        .lca-overlay-hint {
          font-size: 13px;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: rgba(211, 214, 234, 0.7);
        }
      `;
      document.head.appendChild(style);
    }

    this._container = document.createElement("div");
    this._container.className = "lca-hud";

    const timeFlow = document.createElement("div");
    timeFlow.className = "lca-time-flow";
    const label = document.createElement("span");
    label.className = "lca-time-flow-label";
    label.textContent = "Time Flow";
    const track = document.createElement("div");
    track.className = "lca-time-flow-track";
    this._timeFlowFillEl = document.createElement("div");
    this._timeFlowFillEl.className = "lca-time-flow-fill";
    track.appendChild(this._timeFlowFillEl);
    timeFlow.appendChild(label);
    timeFlow.appendChild(track);
    this._container.appendChild(timeFlow);

    this._overlayEl = document.createElement("div");
    this._overlayEl.className = "lca-overlay";
    this._overlayTextEl = document.createElement("span");
    this._overlayTextEl.className = "lca-overlay-text";
    const hint = document.createElement("span");
    hint.className = "lca-overlay-hint";
    hint.textContent = "Press Enter to restart";
    this._overlayEl.appendChild(this._overlayTextEl);
    this._overlayEl.appendChild(hint);
    this._container.appendChild(this._overlayEl);

    document.body.appendChild(this._container);

    this._bindEvents();
  }

  private _bindEvents(): void {
    this.events.addEventListener(Events.ROUND_OVER, (event): void => {
      const won = event["won"] === true;
      this._overlayTextEl.textContent = won ? "Rival De-Rezzed" : "You Were De-Rezzed";
      this._overlayEl.classList.add("visible");
    });
  }

  /** Called every frame so the Time Flow bar reflects the live time-warp scale (0..1). */
  public update(timeScale: number): void {
    this._timeFlowFillEl.style.width = `${Math.round(timeScale * 100)}%`;
    this._timeFlowFillEl.style.background =
      timeScale > 0.5 ? "rgba(120, 230, 255, 0.9)" : "rgba(255, 200, 120, 0.9)";
  }
}
