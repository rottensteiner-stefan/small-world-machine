import type { Vector3D } from "@small-world-machine/engine";

export interface HotspotAction {
  id: string;
  name: string;
  position: Vector3D;
  interactionRadius: number;
  promptText: string;
  monologueTitle?: string | undefined;
  monologueText?: string[] | undefined;
  itemReward?: string | undefined;
  onInteract?: (() => void) | undefined;
}

export class HotspotManager {
  private _hotspots: HotspotAction[] = [];
  private _activeHotspot: HotspotAction | null = null;
  private _promptElement: HTMLElement | null = null;
  private _monologueElement: HTMLElement | null = null;
  private _isMonologueOpen: boolean = false;
  private _currentMonologueIndex: number = 0;
  private _currentMonologueLines: string[] = [];

  constructor() {
    this._bindDomElements();
    this._bindKeys();
  }

  public registerHotspot(hotspot: HotspotAction): void {
    this._hotspots.push(hotspot);
  }

  public clearHotspots(): void {
    this._hotspots = [];
    this._activeHotspot = null;
    this.hidePrompt();
  }

  public get activeHotspot(): HotspotAction | null {
    return this._activeHotspot;
  }

  public get isMonologueOpen(): boolean {
    return this._isMonologueOpen;
  }

  public update(playerPosition: Vector3D): void {
    if (this._isMonologueOpen) return;

    let closest: HotspotAction | null = null;
    let minDistance = Infinity;

    for (const spot of this._hotspots) {
      const dx = playerPosition.x - spot.position.x;
      const dy = playerPosition.y - spot.position.y;
      const dz = playerPosition.z - spot.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist <= spot.interactionRadius && dist < minDistance) {
        minDistance = dist;
        closest = spot;
      }
    }

    if (closest !== this._activeHotspot) {
      this._activeHotspot = closest;
      if (closest) {
        this.showPrompt(closest.promptText);
      } else {
        this.hidePrompt();
      }
    }
  }

  public interact(): boolean {
    if (this._isMonologueOpen) {
      this.advanceMonologue();
      return true;
    }

    if (!this._activeHotspot) return false;

    const spot = this._activeHotspot;
    if (spot.monologueText && spot.monologueText.length > 0) {
      this.showMonologue(spot.monologueTitle ?? spot.name, spot.monologueText);
    }
    if (spot.onInteract) {
      spot.onInteract();
    }
    return true;
  }

  public showMonologue(title: string, lines: string[]): void {
    if (!lines || lines.length === 0) return;
    this._isMonologueOpen = true;
    this._currentMonologueIndex = 0;
    this._currentMonologueLines = lines;
    this.hidePrompt();

    this._renderCurrentMonologuePage(title);
    if (this._monologueElement) {
      this._monologueElement.style.display = "block";
    }
  }

  public advanceMonologue(): void {
    if (!this._isMonologueOpen) return;

    this._currentMonologueIndex++;
    if (this._currentMonologueIndex >= this._currentMonologueLines.length) {
      this.closeMonologue();
    } else {
      const titleEl = document.getElementById("monologueTitle");
      const title = titleEl ? titleEl.innerText : "Gedanke";
      this._renderCurrentMonologuePage(title);
    }
  }

  public closeMonologue(): void {
    this._isMonologueOpen = false;
    this._currentMonologueIndex = 0;
    this._currentMonologueLines = [];
    if (this._monologueElement) {
      this._monologueElement.style.display = "none";
    }
  }

  public showPrompt(text: string): void {
    if (!this._promptElement) return;
    const label = document.getElementById("promptText");
    if (label) {
      label.innerText = text;
    } else {
      this._promptElement.innerText = `[E] ${text}`;
    }
    this._promptElement.style.display = "flex";
  }

  public hidePrompt(): void {
    if (!this._promptElement) return;
    this._promptElement.style.display = "none";
  }

  private _renderCurrentMonologuePage(title: string): void {
    const titleEl = document.getElementById("monologueTitle");
    const bodyEl = document.getElementById("monologueBody");
    const footerEl = document.getElementById("monologueFooter");

    if (titleEl) titleEl.innerText = title;
    if (bodyEl && this._currentMonologueLines[this._currentMonologueIndex]) {
      bodyEl.innerText = this._currentMonologueLines[this._currentMonologueIndex] ?? "";
    }
    if (footerEl) {
      const isLast = this._currentMonologueIndex >= this._currentMonologueLines.length - 1;
      footerEl.innerText = isLast
        ? "[E / LEERTASTE] Schließen"
        : `[E / LEERTASTE] Weiter (${this._currentMonologueIndex + 1}/${this._currentMonologueLines.length})`;
    }
  }

  private _bindDomElements(): void {
    this._promptElement = document.getElementById("interactionPrompt");
    this._monologueElement = document.getElementById("monologueBox");
  }

  private _bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (e.key === "e" || e.key === "E") {
        this.interact();
      } else if (e.key === " " && this._isMonologueOpen) {
        e.preventDefault();
        this.advanceMonologue();
      } else if (e.key === "Escape" && this._isMonologueOpen) {
        this.closeMonologue();
      }
    });
  }
}
