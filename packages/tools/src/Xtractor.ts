import {
  ForgeTool,
  ForgeToolOptions,
  ToolEvents,
  EventDispatcherImpl,
} from "@small-world-machine/engine";
import { AiConfigStorage, createVisionAiProvider } from "./common/ai/index.js";
import {
  detectSpriteBounds,
  magicWand,
  removeBackground,
  generateNormalMap,
  CanvasActionChip,
  CanvasUndoHistory,
} from "./common/image/index.js";
import {
  UniversalIngestDropzone,
  IngestResult,
  CommandHistory,
  bindToolShortcuts,
  isActiveToolHost,
  primaryPbrTexture,
  firstImageItem,
} from "./common/io/index.js";
import { AiChatPanel } from "./xtractor/AiChatPanel.js";
import { CanvasSelection, type SelectionRect } from "./xtractor/CanvasSelection.js";
import { CanvasViewport } from "./xtractor/CanvasViewport.js";
import { injectXtractorStyles } from "./xtractor/xtractorStyles.js";

/** Longer edge (px) the canvas is downscaled to for vision requests. */
const AI_IMAGE_MAX_DIM = 1024;
const NUDGE_STEP = 1;
const NUDGE_STEP_SHIFT = 10;
const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export class Xtractor extends ForgeTool {
  public loadFromBase64?: (base64: string) => void;
  private _abortController = new AbortController();

  public override onPasteImage(base64: string): void {
    if (this.loadFromBase64) {
      this.loadFromBase64(base64);
    }
  }

  public override unmount(): void {
    super.unmount();
    this._abortController.abort();
    this._abortController = new AbortController();
  }

  /** Present when hosted by the Forge; the standalone page has nobody to send crops to. */
  private readonly _events: EventDispatcherImpl | undefined;

  constructor(
    eventsOrOptions?: EventDispatcherImpl | ForgeToolOptions,
    options?: ForgeToolOptions,
  ) {
    const hasEvents = undefined !== eventsOrOptions && "addEventListener" in eventsOrOptions;
    super(hasEvents ? (options ?? {}) : ((eventsOrOptions as ForgeToolOptions | undefined) ?? {}));
    this._events = hasEvents ? (eventsOrOptions as EventDispatcherImpl) : undefined;
    injectXtractorStyles();
    this._buildUI();
    this._bindLogic();
  }

  private _buildUI(): void {
    this._container.className = "swf-ix-main-container";
    this._container.innerHTML = `
    <!-- WORKBENCH -->
    <div class="swf-ix-workbench">
      <div class="swf-ix-toolbar">
        <div class="tool-tabs swf-ix-toolbar-group">
          <button class="tool-btn" id="btn-tool-pan" title="Hand Tool">Hand</button>
          <button class="tool-btn active" id="btn-tool-rect" title="Rechteck Auswahl">Rect</button>
          <button class="tool-btn" id="btn-tool-circle" title="Kreis Auswahl">Circle</button>
          <button class="tool-btn" id="btn-tool-wand" title="Magic Wand (Smart-Masking)">Wand</button>
        </div>
        
        <div class="tool-tabs swf-ix-toolbar-group">
          <button class="tool-btn" id="btn-auto-sprites" title="Automatisch alle Sprites auf dem Sheet erkennen">✨ Auto-Sprites</button>
          <button class="tool-btn" id="btn-remove-bg" title="Hintergrund entfernen (Smart Alpha Matting)">🪄 RemBG</button>
          <button class="tool-btn" id="btn-gen-normal" title="Normal Map erzeugen">🏔️ Normal</button>
        </div>

        <div class="tool-tabs swf-ix-toolbar-group">
          <button class="tool-btn" id="btn-undo" title="Rückgängig (Cmd+Z)">↩ Undo</button>
          <button class="tool-btn" id="btn-redo" title="Wiederholen (Cmd+Shift+Z)">↪ Redo</button>
        </div>

        <div class="tool-tabs swf-ix-toolbar-group">
          <button class="tool-btn" id="btn-zoom-out">-</button>
          <span style="color: var(--tool-text-muted); padding: 0 5px; font-weight: bold; font-size: 0.9rem; align-self: center;" id="zoom-label">100%</span>
          <button class="tool-btn" id="btn-zoom-in">+</button>
        </div>
        
        <button class="tool-btn" style="margin-left: auto;" id="btn-clear-selection">Clear Selection</button>
      </div>
      
      <div class="swf-ix-canvas-container" id="canvas-wrapper">
        <div id="drop-overlay">Drop File Here</div>
        <div id="empty-dropzone-container" style="max-width: 500px; margin: 40px auto 0;"></div>
        <div id="canvas-stage" style="display: none;">
            <canvas id="image-canvas"></canvas>
            <div id="selection-box"></div>
        </div>
        
        <!-- Precision Input Panel -->
        <div id="selection-props" class="tool-panel" style="display: none;">
          <div style="display: flex; align-items: center; gap: 5px; color: var(--tool-text-muted); font-size: 0.9rem; font-weight: bold;"><label>X:</label> <input type="number" id="prop-x" class="tool-input mono" style="width: 56px;"/></div>
          <div style="display: flex; align-items: center; gap: 5px; color: var(--tool-text-muted); font-size: 0.9rem; font-weight: bold;"><label>Y:</label> <input type="number" id="prop-y" class="tool-input mono" style="width: 56px;"/></div>
          <div style="display: flex; align-items: center; gap: 5px; color: var(--tool-text-muted); font-size: 0.9rem; font-weight: bold;"><label>W:</label> <input type="number" id="prop-w" class="tool-input mono" style="width: 56px;"/></div>
          <div style="display: flex; align-items: center; gap: 5px; color: var(--tool-text-muted); font-size: 0.9rem; font-weight: bold;"><label>H:</label> <input type="number" id="prop-h" class="tool-input mono" style="width: 56px;"/></div>
        </div>
      </div>
    </div>
    <!-- SPLITTER -->
    <div class="swf-ix-splitter" id="splitter"></div>

    <!-- CHAT & AI INTERFACE -->
    <div class="swf-ix-sidebar" id="sidebar"></div>`;
  }

  private _bindLogic(): void {
    const signal = this._abortController.signal;
    const canvas = this._container.querySelector<HTMLCanvasElement>("#image-canvas")!;
    const ctx = canvas.getContext("2d")!;
    const canvasWrapper = this._container.querySelector<HTMLElement>("#canvas-wrapper")!;
    const canvasStage = this._container.querySelector<HTMLElement>("#canvas-stage")!;
    const emptyDropzoneContainer = this._container.querySelector<HTMLElement>(
      "#empty-dropzone-container",
    );
    const dropOverlay = this._container.querySelector<HTMLElement>("#drop-overlay")!;

    let currentImage: HTMLImageElement | null = null;
    let currentTool = "rect"; // 'rect' | 'circle' | 'pan' | 'wand'
    const undoHistory = new CanvasUndoHistory(30);

    const chat = new AiChatPanel(this._container.querySelector<HTMLElement>("#sidebar")!, {
      host: {
        getImagePayload: (): string | undefined => buildImagePayload(),
        applyActionChip: (chip: CanvasActionChip): void => applyActionChip(chip),
      },
      configStore: AiConfigStorage,
      createProvider: createVisionAiProvider,
      commandHistory: new CommandHistory({
        maxEntries: 100,
        storageKey: "sw_xtractor_command_history",
        pageStep: 10,
      }),
      signal,
    });
    const btnCancelCrop = this._container.querySelector<HTMLElement>("#btn-cancel-crop")!;
    const btnClearSelection = this._container.querySelector<HTMLElement>("#btn-clear-selection")!;
    const btnSendPixler = this._container.querySelector<HTMLElement>("#btn-send-pixler")!;
    const selection = new CanvasSelection(this._container, canvas);
    const viewport = new CanvasViewport(this._container, () => null !== currentImage);

    const say = (text: string): HTMLElement => chat.addMessage(text, "ai");

    const showCanvasStage = (): void => {
      if (emptyDropzoneContainer) emptyDropzoneContainer.style.display = "none";
      canvasStage.style.display = "block";
    };

    const syncImageFromCanvas = (): void => {
      const img = new Image();
      img.onload = (): void => {
        currentImage = img;
        showCanvasStage();
        const rect = selection.rect;
        if (!rect) return;
        if (rect.x + rect.w > canvas.width || rect.y + rect.h > canvas.height) {
          selection.clear();
        } else {
          selection.recapture();
        }
      };
      img.src = canvas.toDataURL();
    };

    const triggerUndo = (): void => {
      if (!undoHistory.canUndo) {
        say("Nichts mehr zum Rückgängigmachen.");
        return;
      }
      const snap = undoHistory.undo(canvas, ctx, "Aktueller Zustand");
      if (snap) {
        syncImageFromCanvas();
        say(`↩ **Rückgängig gemacht:** ${snap.label}`);
      }
    };

    const triggerRedo = (): void => {
      if (!currentImage || !undoHistory.canRedo) {
        say("Nichts mehr zum Wiederholen.");
        return;
      }
      const snap = undoHistory.redo(canvas, ctx, "Vor Wiederholen");
      if (snap) {
        syncImageFromCanvas();
        say(`↪ **Wiederholt:** ${snap.label}`);
      }
    };

    // Tools
    const btnToolRect = this._container.querySelector<HTMLElement>("#btn-tool-rect")!;
    const btnToolCircle = this._container.querySelector<HTMLElement>("#btn-tool-circle")!;
    const btnToolPan = this._container.querySelector<HTMLElement>("#btn-tool-pan")!;
    const btnToolWand = this._container.querySelector<HTMLElement>("#btn-tool-wand")!;
    const btnAutoSprites = this._container.querySelector<HTMLElement>("#btn-auto-sprites")!;
    const btnRemoveBg = this._container.querySelector<HTMLElement>("#btn-remove-bg")!;
    const btnGenNormal = this._container.querySelector<HTMLElement>("#btn-gen-normal")!;

    this._container.querySelector<HTMLElement>("#btn-undo")?.addEventListener("click", triggerUndo);
    this._container.querySelector<HTMLElement>("#btn-redo")?.addEventListener("click", triggerRedo);

    const setActiveTool = (tool: string): void => {
      currentTool = tool;
      selection.setCircle("circle" === tool);
      btnToolRect.classList.toggle("active", tool === "rect");
      btnToolCircle.classList.toggle("active", tool === "circle");
      btnToolPan.classList.toggle("active", tool === "pan");
      btnToolWand.classList.toggle("active", tool === "wand");

      if (tool === "pan") {
        canvas.style.cursor = "grab";
      } else if (tool === "wand") {
        canvas.style.cursor = "cell";
      } else {
        canvas.style.cursor = "crosshair";
      }
    };

    btnToolRect.addEventListener("click", () => {
      setActiveTool("rect");
      selection.applyShape();
    });
    btnToolCircle.addEventListener("click", () => {
      setActiveTool("circle");
      selection.applyShape();
    });
    btnToolPan.addEventListener("click", () => setActiveTool("pan"));
    btnToolWand.addEventListener("click", () => setActiveTool("wand"));

    const attachSliceGallery = (
      slices: Array<{ rect: SelectionRect; title: string; filename: string }>,
      borderColor: string,
    ): void => {
      const gallery = document.createElement("div");
      gallery.style.display = "flex";
      gallery.style.gap = "6px";
      gallery.style.flexWrap = "wrap";
      gallery.style.marginTop = "10px";

      for (const { rect, title, filename } of slices) {
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = rect.w;
        sliceCanvas.height = rect.h;
        sliceCanvas.style.border = `1px solid ${borderColor}`;
        sliceCanvas.style.background = "var(--tool-panel-solid)";
        sliceCanvas.style.borderRadius = "4px";
        sliceCanvas.style.cursor = "pointer";
        sliceCanvas.title = title;
        sliceCanvas
          .getContext("2d")!
          .drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        sliceCanvas.addEventListener("click", () => {
          const link = document.createElement("a");
          link.download = filename;
          link.href = sliceCanvas.toDataURL("image/png");
          link.click();
        });
        gallery.appendChild(sliceCanvas);
      }
      chat.attachToLastMessage(gallery);
    };

    btnAutoSprites.addEventListener("click", () => {
      if (!currentImage || canvas.width === 0) {
        say("Bitte lade zuerst ein Bild hoch, um Sprites automatisch zu erkennen.");
        return;
      }

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const boxes = detectSpriteBounds(imgData, { minWidth: 8, minHeight: 8, padding: 2 });

      if (boxes.length === 0) {
        say(
          "Keine isolierten Sprites auf transparentem Grund erkannt. (Tipp: Vorher 🪄 RemBG nutzen!).",
        );
        return;
      }

      say(`✨ **${boxes.length} Sprites** automatisch auf dem Sheet erkannt:`);
      attachSliceGallery(
        boxes.map((box, i) => ({
          rect: box,
          title: `Sprite ${i + 1} (${box.w}x${box.h}px)`,
          filename: `sprite_${i + 1}.png`,
        })),
        "var(--tool-accent)",
      );

      const [firstBox] = boxes;
      if (firstBox) selection.select(firstBox);
    });

    btnRemoveBg.addEventListener("click", () => {
      if (!currentImage || canvas.width === 0) {
        say("Bitte lade zuerst ein Bild hoch, um den Hintergrund zu entfernen.");
        return;
      }
      undoHistory.push(canvas, ctx, "Hintergrund entfernen");

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      ctx.putImageData(removeBackground(imgData, { tolerance: 28, feather: 2 }), 0, 0);
      selection.recapture();

      say(
        "🪄 **Hintergrund entfernt!** Hintergrund wurde transparent freigestellt. (Rückgängig mit `Cmd+Z`)",
      );
    });

    btnGenNormal.addEventListener("click", () => {
      if (!currentImage || canvas.width === 0) {
        say("Bitte lade zuerst ein Bild hoch, um eine Normal Map zu berechnen.");
        return;
      }
      const srcData =
        selection.getCropImageData() ?? ctx.getImageData(0, 0, canvas.width, canvas.height);
      showMapPreview("Tangent-Space Normal Map", generateNormalMap(srcData, 2.5), "normal_map.png");
    });

    // Universal Ingest Router & Loading Logic
    const loadBlobAsImage = (blob: Blob): void => {
      const reader = new FileReader();
      reader.onload = (): void => {
        if (this.loadFromBase64) this.loadFromBase64(reader.result as string);
      };
      reader.readAsDataURL(blob);
    };

    const handleIngestResult = (result: IngestResult): void => {
      if (result.kind === "image" || result.kind === "svg") {
        if (this.loadFromBase64) {
          this.loadFromBase64(result.dataUrl);
        }
      } else if (result.kind === "pbr-set") {
        const main = primaryPbrTexture(result.pbrSet);
        if (main && this.loadFromBase64) {
          loadBlobAsImage(main);
          say(`PBR-Set '${result.name}' erkannt & geladen.`);
        }
      } else if (result.kind === "archive" || result.kind === "files") {
        const firstImg = firstImageItem(result);
        if (firstImg && this.loadFromBase64) {
          loadBlobAsImage(firstImg.blob);
          say(`Archiv '${result.name}' entpackt & Bild '${firstImg.name}' geladen.`);
        }
      } else if (result.kind === "json") {
        say(`JSON-Datei '${result.name}' eingelesen.`);
      }
    };

    if (emptyDropzoneContainer) {
      new UniversalIngestDropzone({
        container: emptyDropzoneContainer,
        label: "Bild, PDF oder ZIP ablegen",
        supportedKinds: ["image", "pbr-set", "zip", "files", "svg", "text"],
        enableWindowDrop: true,
        enablePaste: true,
        onIngest: async (result: IngestResult): Promise<void> => {
          handleIngestResult(result);
        },
        onError: (err: Error): void => {
          alert(err.message);
        },
      });
    }

    canvasWrapper.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropOverlay.style.display = "flex";
    });
    canvasWrapper.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dropOverlay.style.display = "none";
    });
    // The dropzone (window drop) routes the files; here we only hide the overlay.
    canvasWrapper.addEventListener("drop", () => {
      dropOverlay.style.display = "none";
    });

    this.loadFromBase64 = (base64: string): void => {
      const img = new Image();
      img.onload = (): void => {
        currentImage = img;
        showCanvasStage();
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        selection.clear();
        say(`Bild geladen (${img.width}x${img.height}px).`);
      };
      img.src = base64;
    };

    // The removal is a history entry, so Cmd+Z brings the image back instead of asking first.
    const removeImage = (): void => {
      undoHistory.push(canvas, ctx, "Bild entfernen");
      currentImage = null;
      canvas.width = 0;
      canvas.height = 0;
      selection.clear();
      canvasStage.style.display = "none";
      if (emptyDropzoneContainer) emptyDropzoneContainer.style.display = "block";
      viewport.reset();
      say("Bild entfernt. (Rückgängig mit `Cmd+Z`)");
    };

    const unbindShortcuts = bindToolShortcuts({
      undo: (): void => {
        if (isActiveToolHost(this._container)) triggerUndo();
      },
      redo: (): void => {
        if (isActiveToolHost(this._container)) triggerRedo();
      },
    });
    signal.addEventListener("abort", unbindShortcuts, { once: true });

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!this._container.isConnected || !isActiveToolHost(this._container)) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if ("d" === e.key.toLowerCase()) {
          e.preventDefault();
          selection.clear();
          return;
        }
        if ("0" === e.key) {
          e.preventDefault();
          viewport.fitToWindow(canvas.width, canvas.height);
          return;
        }
        if ("1" === e.key) {
          e.preventDefault();
          viewport.resetTo100();
          return;
        }
      }

      if ("Escape" === e.key) {
        selection.clear();
        return;
      }

      const arrow = ARROW_DELTAS[e.key];
      if (arrow && selection.rect) {
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_STEP_SHIFT : NUDGE_STEP;
        selection.nudge(arrow[0] * step, arrow[1] * step);
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && currentImage) {
        e.preventDefault();
        removeImage();
      }
    };

    window.addEventListener("keydown", onKeyDown, { signal });

    canvas.addEventListener("mousedown", (e) => {
      if (!currentImage) return;

      if (currentTool === "pan") {
        viewport.startPan(e);
        canvas.style.cursor = "grabbing";
        return;
      }

      if (currentTool === "wand") {
        const p = selection.toCanvasPoint(e);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const wandRes = magicWand(imgData, Math.round(p.x), Math.round(p.y), 32);
        if (wandRes && wandRes.box.w > 4 && wandRes.box.h > 4) {
          selection.select(wandRes.box);
        }
        return;
      }

      selection.pointerDown(e);
    });

    canvas.addEventListener("mousemove", (e) => {
      if (!currentImage) return;
      if (viewport.isPanning) {
        viewport.pan(e);
        return;
      }
      selection.pointerMove(e);
    });

    canvas.addEventListener("mouseup", (e) => {
      if (viewport.isPanning) {
        viewport.endPan();
        canvas.style.cursor = "grab";
        return;
      }
      selection.pointerUp(e);
    });

    btnCancelCrop.addEventListener("click", () => selection.clear());
    btnClearSelection.addEventListener("click", () => selection.clear());

    btnSendPixler.addEventListener("click", () => {
      if (selection.rect) {
        const base64 = selection.cropCanvas.toDataURL("image/png");
        this._events?.dispatchEvent(ToolEvents.Pixler.LOAD_BASE64, { base64 });
      }
    });

    function buildImagePayload(): string | undefined {
      if (selection.hasCrop) {
        return selection.cropCanvas.toDataURL("image/png");
      }
      if (!currentImage || canvas.width <= 0 || canvas.height <= 0) {
        return undefined;
      }
      if (canvas.width <= AI_IMAGE_MAX_DIM && canvas.height <= AI_IMAGE_MAX_DIM) {
        return canvas.toDataURL("image/png");
      }
      const scale = Math.min(AI_IMAGE_MAX_DIM / canvas.width, AI_IMAGE_MAX_DIM / canvas.height);
      const thumb = document.createElement("canvas");
      thumb.width = Math.round(canvas.width * scale);
      thumb.height = Math.round(canvas.height * scale);
      thumb.getContext("2d")!.drawImage(canvas, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL("image/jpeg", 0.85);
    }

    function executeSlice(numSlices: number): void {
      const rect = selection.rect;
      if (!rect) {
        say("Bitte wähle zuerst einen Bereich auf der Canvas aus, um ihn zu zerteilen.");
        return;
      }
      const count = Math.max(1, Math.min(64, numSlices));
      const sliceWidth = rect.w / count;

      say(`Bereich in ${count} gleichmäßige Segmente unterteilt:`);
      attachSliceGallery(
        Array.from({ length: count }, (_unused, i) => ({
          rect: { x: rect.x + i * sliceWidth, y: rect.y, w: sliceWidth, h: rect.h },
          title: `Sprite ${i + 1} (Klicken zum Download)`,
          filename: `sprite_slice_${i + 1}.png`,
        })),
        "var(--tool-accent2)",
      );
    }

    function replaceCanvasData(newImgData: ImageData): void {
      canvas.width = newImgData.width;
      canvas.height = newImgData.height;
      ctx.putImageData(newImgData, 0, 0);
      const img = new Image();
      img.onload = (): void => {
        currentImage = img;
        selection.clear();
      };
      img.src = canvas.toDataURL();
    }

    function showMapPreview(title: string, mapData: ImageData, defaultFilename: string): void {
      const mCanvas = document.createElement("canvas");
      mCanvas.width = mapData.width;
      mCanvas.height = mapData.height;
      mCanvas.getContext("2d")!.putImageData(mapData, 0, 0);

      const previewDiv = document.createElement("div");
      previewDiv.style.marginTop = "8px";
      mCanvas.style.maxWidth = "100%";
      mCanvas.style.border = "1px solid var(--tool-border)";
      mCanvas.style.borderRadius = "4px";
      previewDiv.appendChild(mCanvas);

      const btnDl = document.createElement("button");
      btnDl.className = "tool-btn primary";
      btnDl.style.marginTop = "6px";
      btnDl.style.fontSize = "0.8rem";
      btnDl.style.padding = "4px 8px";
      btnDl.innerText = `📥 ${title} herunterladen`;
      btnDl.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = mCanvas.toDataURL("image/png");
        a.download = defaultFilename;
        a.click();
      });
      previewDiv.appendChild(btnDl);

      say(`✨ **${title}** berechnet:`).appendChild(previewDiv);
    }

    function applyActionChip(chip: CanvasActionChip): void {
      if (!currentImage || canvas.width === 0) {
        say("Bitte lade zuerst ein Bild hoch, um eine Aktion auszuführen.");
        return;
      }

      const srcData =
        selection.getCropImageData() ?? ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = chip.execute(srcData);

      if ("data" in result && (result as ImageData).data instanceof Uint8ClampedArray) {
        undoHistory.push(canvas, ctx, chip.label || "Bildaktion");
        const newImgData = result as ImageData;
        const rect = selection.rect;
        if (
          rect &&
          selection.hasCrop &&
          newImgData.width === rect.w &&
          newImgData.height === rect.h
        ) {
          ctx.putImageData(newImgData, rect.x, rect.y);
          selection.recapture();
        } else {
          replaceCanvasData(newImgData);
        }
        say(`✅ **${chip.label}** angewendet! (Rückgängig mit \`Cmd+Z\`)`);
        return;
      }

      const customRes = result as {
        normalMap?: ImageData;
        depthMap?: ImageData;
        sliceCount?: number;
        autoSprites?: boolean;
      };
      if (customRes.autoSprites) {
        btnAutoSprites.click();
      } else if (customRes.sliceCount) {
        executeSlice(customRes.sliceCount);
      } else if (customRes.normalMap) {
        showMapPreview("Tangent-Space Normal Map", customRes.normalMap, "normal_map.png");
      } else if (customRes.depthMap) {
        showMapPreview("Depth / Height Map", customRes.depthMap, "depth_map.png");
      }
    }

    this._bindSplitter();
  }

  private _bindSplitter(): void {
    const splitter = this._container.querySelector<HTMLElement>("#splitter")!;
    const sidebar = this._container.querySelector<HTMLElement>("#sidebar")!;
    let isSplitting = false;

    splitter.addEventListener("mousedown", () => {
      isSplitting = true;
      splitter.classList.add("active");
      document.body.style.cursor = "col-resize";
    });

    document.addEventListener("mousemove", (e) => {
      if (!isSplitting) return;
      const containerRect = this._container.getBoundingClientRect();
      const newWidth = containerRect.right - e.clientX;
      if (newWidth > 250 && newWidth < containerRect.width - 300) {
        sidebar.style.width = newWidth + "px";
      }
    });

    document.addEventListener("mouseup", () => {
      if (isSplitting) {
        isSplitting = false;
        splitter.classList.remove("active");
        document.body.style.cursor = "";
      }
    });
  }

  public getState(): unknown {
    return null;
  }
  public setState(_state: unknown): void {}
}
