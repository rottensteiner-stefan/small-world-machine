import { ForgeTool, ForgeToolOptions } from "@small-world-machine/engine";
import { UniversalIngestDropzone } from "./common/io/ui/UniversalIngestDropzone.js";
import type { IngestResult } from "./common/io/UniversalIngestTypes.js";

export class MapGenerator extends ForgeTool {
  private _gridWidth = 40;
  private _gridHeight = 25;
  private _cellSize = 16;
  private _grid: string[][] = [];
  private _dropzone?: UniversalIngestDropzone;

  private _canvas!: HTMLCanvasElement;
  private _ctx!: CanvasRenderingContext2D;

  private _inputW!: HTMLInputElement;
  private _inputH!: HTMLInputElement;

  private _currentChar: string = "W";
  private _isDrawing = false;

  private _hoverX = -1;
  private _hoverY = -1;

  // Mapping characters to colors for rendering
  private _palette: Record<string, { color: string; label: string }> = {
    W: { color: "#555555", label: "Wall" },
    G: { color: "#444444", label: "Wall 2" },
    "+": { color: "#00ff00", label: "Door" },
    O: { color: "#005500", label: "Secret" },
    P: { color: "#0000ff", label: "Player" },
    E: { color: "#ff0000", label: "Enemy" },
    b: { color: "#a0522d", label: "Barrel" },
    I: { color: "#ffd700", label: "Item" },
    l: { color: "#ffaa00", label: "Torch" },
    T: { color: "#ff5500", label: "Lava" },
    "~": { color: "#00ffaa", label: "Slime" },
    ".": { color: "#1a1a1a", label: "Empty" },
  };

  /** Ends the window-level listeners when the tool's window is torn down. */
  private readonly _abortController = new AbortController();

  public override unmount(): void {
    super.unmount();
    this._abortController.abort();
  }

  constructor(options: ForgeToolOptions = {}) {
    super(options);
    this._initGrid();
    this._injectCSS();
    this._buildUI();
    this._bindEvents();
    this._render();
  }

  private _initGrid(): void {
    this._grid = [];
    for (let y = 0; y < this._gridHeight; y++) {
      const row: string[] = [];
      for (let x = 0; x < this._gridWidth; x++) {
        row.push(".");
      }
      this._grid.push(row);
    }
  }

  private _resizeGrid(newW: number, newH: number): void {
    const oldGrid = this._grid;
    this._gridWidth = newW;
    this._gridHeight = newH;
    this._grid = [];

    for (let y = 0; y < this._gridHeight; y++) {
      const row: string[] = [];
      for (let x = 0; x < this._gridWidth; x++) {
        if (oldGrid[y] && oldGrid[y]![x]) {
          row.push(oldGrid[y]![x]!);
        } else {
          row.push(".");
        }
      }
      this._grid.push(row);
    }
    this._render();
  }

  private _injectCSS(): void {
    if (document.getElementById("mapgen-style")) return;
    const style = document.createElement("style");
    style.id = "mapgen-style";
    style.innerHTML = `
      .mapgen-container {
        display: flex;
        flex-direction: row;
        width: 100%;
        height: 100%;
        background: transparent;
        color: var(--swf-text);
        font-family: var(--swf-font);
      }
      .mapgen-toolbar {
        width: 280px;
        background: var(--swf-panel);
        border-right: 1px solid var(--swf-border);
        display: flex;
        flex-direction: column;
        padding: 1rem;
        gap: 0.75rem;
        overflow-y: auto;
      }
      .mapgen-canvas-wrapper {
        flex: 1;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: center;
        background: repeating-conic-gradient(rgba(30, 41, 59, 0.5) 0% 25%, rgba(15, 23, 42, 0.5) 0% 50%) 50% / 20px 20px;
      }
      .mapgen-canvas {
        /* shared.css sizes every canvas to 100vw x 100vh; the grid's own size must win here. */
        width: auto;
        height: auto;
        box-shadow: var(--swf-shadow);
        cursor: crosshair;
        background: #1a1a1a;
      }
      .mapgen-palette {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 5px;
      }
      .mapgen-palette-btn {
        background: rgba(0,0,0,0.3);
        color: var(--swf-text);
        border: 1px solid var(--swf-border);
        padding: 8px 4px;
        cursor: pointer;
        text-align: center;
        font-weight: bold;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        align-items: center;
        font-size: 11px;
        gap: 2px;
      }
      .mapgen-palette-btn:hover {
        background: var(--swf-panel-hover);
      }
      .mapgen-palette-btn.active {
        border-color: var(--swf-accent);
        background: rgba(0, 229, 255, 0.2);
      }
      .mapgen-textarea {
        width: 100%;
        height: 120px;
        background: rgba(0,0,0,0.3);
        color: var(--swf-accent);
        border: 1px solid var(--swf-border);
        padding: 8px;
        font-size: 10px;
        font-family: monospace;
        resize: vertical;
        box-sizing: border-box;
      }
      .mapgen-inputs {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .mapgen-inputs input {
        width: 50px;
      }
      .mapgen-btn-play {
        background: #10b981;
        color: white;
        margin-top: 10px;
        font-size: 1.1em;
        text-transform: uppercase;
        letter-spacing: 1px;
        padding: 0.75rem;
      }
      .mapgen-btn-play:hover { background: #34d399; }
      .mapgen-header { margin:0; font-size:1.1em; color:var(--swf-text-muted); border-bottom:1px solid var(--swf-border); padding-bottom:5px;}
    `;
    document.head.appendChild(style);
  }

  private _buildUI(): void {
    this._container.innerHTML = `
      <div class="mapgen-container">
        <div class="mapgen-toolbar">
          <h3 class="mapgen-header">Grid Size</h3>
          <div class="mapgen-inputs">
            W: <input type="number" id="mapgen-w" class="swf-input" value="${this._gridWidth}">
            H: <input type="number" id="mapgen-h" class="swf-input" value="${this._gridHeight}">
            <button class="swf-btn" id="mapgen-btn-resize" style="padding:4px 8px;">Resize</button>
          </div>

          <h3 class="mapgen-header" style="margin-top:10px;">Palette</h3>
          <div class="mapgen-palette" id="mapgen-palette"></div>
          
          <button class="swf-btn" id="mapgen-btn-fill">Bucket Fill (Empty)</button>
          <button class="swf-btn" id="mapgen-btn-clear" style="background:#ef4444; color:white; border-color:#b91c1c;">Clear Map</button>

          <h3 class="mapgen-header" style="margin-top:10px;">Universal IO Import</h3>
          <div id="mapgen-ingest-slot"></div>
          
          <h3 class="mapgen-header" style="margin-top:10px;">Export</h3>
          <button class="swf-btn secondary" id="mapgen-btn-export">Map kopieren (Clipboard) 📋</button>
          
          <button class="swf-btn mapgen-btn-play" id="mapgen-btn-play" style="border-color:#059669;">\u25B6 Play in YAD</button>
        </div>
        <div class="mapgen-canvas-wrapper">
          <canvas class="mapgen-canvas" id="mapgen-canvas"></canvas>
        </div>
      </div>
    `;

    this._canvas = this._container.querySelector<HTMLCanvasElement>("#mapgen-canvas")!;
    this._ctx = this._canvas.getContext("2d")!;
    this._inputW = this._container.querySelector<HTMLInputElement>("#mapgen-w")!;
    this._inputH = this._container.querySelector<HTMLInputElement>("#mapgen-h")!;

    // Mount Universal Ingest Dropzone
    const ingestSlot = this._container.querySelector<HTMLElement>("#mapgen-ingest-slot");
    if (ingestSlot) {
      this._dropzone = new UniversalIngestDropzone({
        container: ingestSlot,
        label: "Map, Level, Bild oder Text ablegen",
        sublabel: ".txt, .map, .json, .png, .zip, URL oder Cmd+V",
        supportedKinds: ["text", "json", "image", "svg", "archive", "files", "any"],
        enableWindowDrop: true,
        enablePaste: true,
        onIngest: async (result: IngestResult): Promise<void> => {
          await this._handleIngestResult(result);
        },
        onError: (err: Error): void => {
          console.error("MapGenerator Ingest Fehler:", err);
        },
      });
    }

    // Build Palette
    const paletteContainer = this._container.querySelector<HTMLElement>("#mapgen-palette")!;
    for (const [char, meta] of Object.entries(this._palette)) {
      const btn = document.createElement("button");
      btn.className = "mapgen-palette-btn";
      if (char === this._currentChar) btn.classList.add("active");
      btn.dataset["char"] = char;

      const swatch = document.createElement("div");
      swatch.style.width = "20px";
      swatch.style.height = "20px";
      swatch.style.background = meta.color;
      swatch.style.border = "1px solid #1e293b";
      swatch.style.display = "flex";
      swatch.style.justifyContent = "center";
      swatch.style.alignItems = "center";
      swatch.style.color = "#fff";
      swatch.style.fontSize = "12px";
      swatch.innerText = char;

      btn.appendChild(swatch);
      btn.appendChild(document.createTextNode(meta.label));

      paletteContainer.appendChild(btn);
    }
  }

  private _bindEvents(): void {
    this._canvas.addEventListener("mousedown", this._onPointerDown.bind(this));
    this._canvas.addEventListener("mousemove", this._onPointerMove.bind(this));
    this._canvas.addEventListener("mouseleave", () => {
      this._hoverX = -1;
      this._hoverY = -1;
      this._render();
    });
    window.addEventListener("mouseup", this._onPointerUp.bind(this), {
      signal: this._abortController.signal,
    });

    const paletteBtns = this._container.querySelectorAll(".mapgen-palette-btn");
    paletteBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        paletteBtns.forEach((b) => b.classList.remove("active"));
        const target = e.currentTarget as HTMLElement;
        target.classList.add("active");
        this._currentChar = target.dataset["char"] || "W";
      });
    });

    this._container.querySelector("#mapgen-btn-export")?.addEventListener("click", () => {
      const mapStr = this.getMapString();
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(mapStr).catch(() => {});
      }
      const btn = this._container.querySelector("#mapgen-btn-export") as HTMLButtonElement;
      if (btn) {
        const oldText = btn.textContent;
        btn.textContent = "✓ In Zwischenablage kopiert!";
        setTimeout(() => {
          if (btn) btn.textContent = oldText;
        }, 1500);
      }
    });

    // Clearing needs a second click within a few seconds instead of a blocking confirm() dialog
    // (which would also freeze the scene underneath a Forge window).
    const clearBtn = this._container.querySelector<HTMLButtonElement>("#mapgen-btn-clear");
    let disarm: ReturnType<typeof setTimeout> | undefined;
    clearBtn?.addEventListener("click", () => {
      if (undefined === disarm) {
        const label = clearBtn.textContent;
        clearBtn.textContent = "Wirklich löschen? (nochmal klicken)";
        disarm = setTimeout(() => {
          clearBtn.textContent = label;
          disarm = undefined;
        }, 3000);
        return;
      }
      clearTimeout(disarm);
      disarm = undefined;
      clearBtn.textContent = "Clear Map";
      this._initGrid();
      this._render();
    });

    this._container.querySelector("#mapgen-btn-resize")?.addEventListener("click", () => {
      const w = parseInt(this._inputW.value, 10);
      const h = parseInt(this._inputH.value, 10);
      if (w > 0 && h > 0) {
        this._resizeGrid(w, h);
      }
    });

    this._container.querySelector("#mapgen-btn-fill")?.addEventListener("click", () => {
      // Replace all '.' with currentChar
      for (let y = 0; y < this._gridHeight; y++) {
        for (let x = 0; x < this._gridWidth; x++) {
          if (this._grid[y]![x] === ".") {
            this._grid[y]![x] = this._currentChar;
          }
        }
      }
      this._render();
    });

    this._container.querySelector("#mapgen-btn-play")?.addEventListener("click", () => {
      const mapStr = this.getMapString();
      localStorage.setItem("yad_custom_map", mapStr);
      window.open("/apps/sample-apps/yad/index.html", "_blank");
    });
  }

  private _onPointerDown(e: MouseEvent): void {
    this._isDrawing = true;
    this._paint(e);
  }

  private _onPointerMove(e: MouseEvent): void {
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / rect.width;
    const scaleY = this._canvas.height / rect.height;

    const x = Math.floor(((e.clientX - rect.left) * scaleX) / this._cellSize);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / this._cellSize);

    if (this._hoverX !== x || this._hoverY !== y) {
      this._hoverX = x;
      this._hoverY = y;
      if (!this._isDrawing) {
        this._render(); // update hover
      }
    }

    if (this._isDrawing) {
      this._paint(e);
    }
  }

  private _onPointerUp(): void {
    this._isDrawing = false;
  }

  private _paint(e: MouseEvent): void {
    const rect = this._canvas.getBoundingClientRect();
    const scaleX = this._canvas.width / rect.width;
    const scaleY = this._canvas.height / rect.height;

    const x = Math.floor(((e.clientX - rect.left) * scaleX) / this._cellSize);
    const y = Math.floor(((e.clientY - rect.top) * scaleY) / this._cellSize);

    if (x >= 0 && x < this._gridWidth && y >= 0 && y < this._gridHeight) {
      if (this._grid[y]![x] !== this._currentChar) {
        this._grid[y]![x] = this._currentChar;
        this._render();
      }
    }
  }

  private _render(): void {
    if (!this._ctx) return;
    this._canvas.width = this._gridWidth * this._cellSize;
    this._canvas.height = this._gridHeight * this._cellSize;

    this._ctx.fillStyle = this._palette["."]!.color;
    this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

    for (let y = 0; y < this._gridHeight; y++) {
      for (let x = 0; x < this._gridWidth; x++) {
        const char = this._grid[y]![x]!;
        if (char !== ".") {
          this._ctx.fillStyle = this._palette[char]?.color || "#ffffff";
          this._ctx.fillRect(
            x * this._cellSize,
            y * this._cellSize,
            this._cellSize,
            this._cellSize,
          );
        }

        // Draw grid lines
        this._ctx.strokeStyle = "#333333";
        this._ctx.strokeRect(
          x * this._cellSize,
          y * this._cellSize,
          this._cellSize,
          this._cellSize,
        );

        if (this._cellSize >= 16 && char !== ".") {
          this._ctx.fillStyle = "#ffffff";
          this._ctx.font = "10px monospace";
          this._ctx.textAlign = "center";
          this._ctx.textBaseline = "middle";
          this._ctx.fillText(
            char,
            x * this._cellSize + this._cellSize / 2,
            y * this._cellSize + this._cellSize / 2,
          );
        }

        // Hover effect
        if (x === this._hoverX && y === this._hoverY) {
          this._ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
          this._ctx.fillRect(
            x * this._cellSize,
            y * this._cellSize,
            this._cellSize,
            this._cellSize,
          );
          this._ctx.strokeStyle = "#ffffff";
          this._ctx.strokeRect(
            x * this._cellSize,
            y * this._cellSize,
            this._cellSize,
            this._cellSize,
          );
        }
      }
    }
  }

  public getMapString(): string {
    return this._grid.map((row) => row.join("")).join("\n");
  }

  public loadMapString(mapStr: string): void {
    if (!mapStr.trim()) return;
    const normalized =
      mapStr.includes("\\n") && !mapStr.includes("\n") ? mapStr.replace(/\\n/g, "\n") : mapStr;
    const lines = normalized
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim());
    if (lines.length > 0) {
      this._gridHeight = lines.length;
      this._gridWidth = lines[0]!.length;
      this._inputW.value = this._gridWidth.toString();
      this._inputH.value = this._gridHeight.toString();

      this._grid = [];
      for (let y = 0; y < this._gridHeight; y++) {
        const row = lines[y]!.split("");
        // Pad if needed
        while (row.length < this._gridWidth) row.push(".");
        this._grid.push(row);
      }
      this._render();
    }
  }

  public getState(): unknown {
    return this.getMapString();
  }

  public setState(state: unknown): void {
    if (typeof state === "string") {
      this.loadMapString(state);
    }
  }

  private async _handleIngestResult(result: IngestResult): Promise<void> {
    switch (result.kind) {
      case "text": {
        this.loadMapString(result.text);
        break;
      }
      case "json": {
        if (Array.isArray(result.data)) {
          if (result.data.every((r) => typeof r === "string")) {
            this.loadMapString((result.data as string[]).join("\n"));
          } else {
            this.loadMapString(result.rawText);
          }
        } else if (result.data && typeof result.data === "object") {
          const obj = result.data as Record<string, unknown>;
          if (typeof obj["map"] === "string") {
            this.loadMapString(obj["map"]);
          } else if (typeof obj["ascii"] === "string") {
            this.loadMapString(obj["ascii"]);
          } else if (
            Array.isArray(obj["grid"]) &&
            obj["grid"].every((r) => typeof r === "string")
          ) {
            this.loadMapString((obj["grid"] as string[]).join("\n"));
          } else {
            this.loadMapString(result.rawText);
          }
        } else {
          this.loadMapString(result.rawText);
        }
        break;
      }
      case "archive": {
        const textFile = result.files.find((f) => /\.(?:map|txt|json)$/i.test(f.name));
        if (textFile) {
          const text = new TextDecoder().decode(textFile.data);
          this.loadMapString(text);
        } else {
          const imgFile = result.files.find((f) => f.mimeType.startsWith("image/"));
          if (imgFile) {
            const blobUrl = URL.createObjectURL(imgFile.blob);
            try {
              await this.loadFromImage(blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          }
        }
        break;
      }
      case "files": {
        const textFile = result.files.find((f) => /\.(?:map|txt|json)$/i.test(f.name));
        if (textFile) {
          const text = await textFile.text();
          this.loadMapString(text);
        } else {
          const imgFile = result.files.find((f) => f.type.startsWith("image/"));
          if (imgFile) {
            const blobUrl = URL.createObjectURL(imgFile);
            try {
              await this.loadFromImage(blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          }
        }
        break;
      }
      case "image": {
        await this.loadFromImage(result.image);
        break;
      }
      case "svg": {
        await this.loadFromImage(result.dataUrl);
        break;
      }
    }
  }

  public async loadFromImage(source: HTMLImageElement | string): Promise<void> {
    let img: HTMLImageElement;
    if (typeof source === "string") {
      img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = (): void => resolve();
        img.onerror = (): void => reject(new Error("Bild konnte nicht geladen werden"));
        img.src = source;
      });
    } else {
      img = source;
    }

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (w <= 0 || h <= 0) return;

    let targetW = this._gridWidth;
    let targetH = this._gridHeight;
    if (w <= 128 && h <= 128) {
      targetW = w;
      targetH = h;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    const data = imgData.data;

    this._gridWidth = targetW;
    this._gridHeight = targetH;
    this._inputW.value = targetW.toString();
    this._inputH.value = targetH.toString();
    this._grid = [];

    const paletteRgb: Array<{ char: string; r: number; g: number; b: number }> = [];
    for (const [char, meta] of Object.entries(this._palette)) {
      if (char === ".") continue;
      const hex = meta.color.replace("#", "");
      let r = 0;
      let g = 0;
      let b = 0;
      if (hex.length === 6) {
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
      }
      paletteRgb.push({ char, r, g, b });
    }

    for (let y = 0; y < targetH; y++) {
      const row: string[] = [];
      for (let x = 0; x < targetW; x++) {
        const idx = (y * targetW + x) * 4;
        const r = data[idx] ?? 0;
        const g = data[idx + 1] ?? 0;
        const b = data[idx + 2] ?? 0;
        const a = data[idx + 3] ?? 0;

        if (a < 64) {
          row.push(".");
          continue;
        }

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let bestChar = lum < 120 ? "W" : ".";
        let bestDist = Infinity;
        for (const p of paletteRgb) {
          const dr = r - p.r;
          const dg = g - p.g;
          const db = b - p.b;
          const dist = dr * dr + dg * dg + db * db;
          if (dist < bestDist) {
            bestDist = dist;
            bestChar = p.char;
          }
        }

        if (lum > 200 && bestDist > 2000) {
          row.push(".");
        } else {
          row.push(bestChar);
        }
      }
      this._grid.push(row);
    }

    this._render();
  }

  public dispose(): void {
    this._dropzone?.dispose();
  }
}
