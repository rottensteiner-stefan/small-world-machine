import { isActiveToolHost } from "./toolHost.js";
import { UniversalIngestRouter } from "../UniversalIngestRouter.js";
import type { IngestResult, IngestTargetKind } from "../UniversalIngestTypes.js";
import { ensureIoStyles } from "./ioStyles.js";

export interface UniversalDropzoneOptions {
  container?: HTMLElement;
  label?: string;
  sublabel?: string;
  supportedKinds?: IngestTargetKind[];
  enableWindowDrop?: boolean;
  enablePaste?: boolean;
  /** Longer edge in px that dropped SVGs are sized to (default 1024); 0 keeps the intrinsic size. */
  svgLongEdge?: number;
  onIngest: (result: IngestResult) => void | Promise<void>;
  onError?: (error: Error) => void;
}

const ICON_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

/** Inline stroke icons (24x24 grid), sized through CSS. */
const ICONS = {
  upload: `<svg ${ICON_ATTRS}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  file: `<svg ${ICON_ATTRS}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`,
  folder: `<svg ${ICON_ATTRS}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  link: `<svg ${ICON_ATTRS}><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33"/></svg>`,
  paste: `<svg ${ICON_ATTRS}><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
} as const;

const FORMATS_HINT =
  "Dateien, Ordner, ZIP oder URL ablegen. PNG, JPG, WebP, SVG, glTF/GLB, JSON, ZIP/GZ und PBR-Map-Sets. Einfügen mit Cmd+V.";

/**
 * Universal Ingest DropZone component featuring Ghost Overlay, Folder import,
 * Clipboard Paste, URL loading modal, and PBR auto-matching.
 * Compact single-row layout: icon, short label, icon-only action buttons.
 */
export class UniversalIngestDropzone {
  private readonly _options: UniversalDropzoneOptions;
  private readonly _router: UniversalIngestRouter;
  private readonly _root: HTMLElement;
  private readonly _fileInput: HTMLInputElement;
  private readonly _folderInput: HTMLInputElement;
  private _dragDepth = 0;
  private readonly _disposers: (() => void)[] = [];

  constructor(options: UniversalDropzoneOptions) {
    this._options = options;
    this._router = new UniversalIngestRouter(
      undefined === options.svgLongEdge ? {} : { svgLongEdge: options.svgLongEdge },
    );
    ensureIoStyles(document);

    this._root = document.createElement("div");
    this._root.className = "sw-universal-dropzone";

    // Hidden inputs
    this._fileInput = document.createElement("input");
    this._fileInput.type = "file";
    this._fileInput.multiple = true;
    this._fileInput.style.display = "none";
    this._root.appendChild(this._fileInput);

    this._folderInput = document.createElement("input");
    this._folderInput.type = "file";
    this._folderInput.webkitdirectory = true;
    this._folderInput.style.display = "none";
    this._root.appendChild(this._folderInput);

    this._buildUI();
    this._bindEvents();

    if (options.container) {
      options.container.appendChild(this._root);
    }
  }

  public get element(): HTMLElement {
    return this._root;
  }

  public dispose(): void {
    this._disposers.forEach((d) => d());
    this._disposers.length = 0;
    this._root.remove();
  }

  private _buildUI(): void {
    const labelText = this._options.label || "Hier ablegen";
    const subText = this._options.sublabel || "";

    // Sublabel, supported formats and shortcuts live in a tooltip instead of permanent text.
    this._root.title = subText ? `${subText}\n${FORMATS_HINT}` : FORMATS_HINT;
    this._root.innerHTML = `
      <div class="sw-dropzone-inner">
        <span class="sw-dropzone-icon">${ICONS.upload}</span>
        <div class="sw-dropzone-text">
          <div class="sw-dropzone-title">${labelText}</div>
        </div>
        <div class="sw-dropzone-actions">
          <button type="button" class="sw-dropzone-btn sw-btn-file" title="Dateien wählen" aria-label="Dateien wählen">${ICONS.file}</button>
          <button type="button" class="sw-dropzone-btn sw-btn-folder" title="Ordner importieren" aria-label="Ordner importieren">${ICONS.folder}</button>
          <button type="button" class="sw-dropzone-btn sw-btn-url" title="Von URL laden" aria-label="Von URL laden">${ICONS.link}</button>
          <button type="button" class="sw-dropzone-btn sw-btn-paste" title="Aus Zwischenablage einfügen (Cmd+V)" aria-label="Aus Zwischenablage einfügen">${ICONS.paste}</button>
        </div>
      </div>
    `;

    // Inject minimal dropzone styles if not already present
    this._injectStyles();
  }

  private _injectStyles(): void {
    if (document.getElementById("sw-universal-dropzone-style")) return;
    const style = document.createElement("style");
    style.id = "sw-universal-dropzone-style";
    style.textContent = `
      .sw-universal-dropzone {
        border: 1.5px dashed var(--tool-border, #334155);
        border-radius: 8px;
        background: var(--tool-bg-subtle, rgba(30, 41, 59, 0.4));
        padding: 8px 10px;
        transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
        user-select: none;
        position: relative;
        cursor: pointer;
      }
      .sw-universal-dropzone:hover, .sw-universal-dropzone.drag-active {
        border-color: var(--tool-accent, #3b82f6);
        background: var(--tool-bg-hover, rgba(59, 130, 246, 0.08));
      }
      .sw-universal-dropzone.drag-active {
        border-style: solid;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
      }
      .sw-dropzone-inner {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .sw-dropzone-icon {
        color: var(--tool-accent, #3b82f6);
        display: inline-flex;
        flex: none;
      }
      .sw-dropzone-icon svg {
        width: 22px;
        height: 22px;
      }
      .sw-dropzone-text {
        flex: 1;
        min-width: 0;
        text-align: left;
      }
      .sw-dropzone-title {
        font-size: 0.82rem;
        font-weight: 600;
        color: var(--tool-text, #f8fafc);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sw-dropzone-actions {
        display: flex;
        gap: 4px;
        flex: none;
      }
      .sw-dropzone-btn {
        background: var(--tool-surface, #1e293b);
        border: 1px solid var(--tool-border, #334155);
        border-radius: 6px;
        color: var(--tool-text, #f8fafc);
        font-size: 0.78rem;
        font-weight: 500;
        padding: 0 10px;
        height: 28px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }
      .sw-dropzone-actions .sw-dropzone-btn {
        width: 28px;
        padding: 0;
      }
      .sw-dropzone-btn svg {
        width: 15px;
        height: 15px;
      }
      .sw-dropzone-btn:hover {
        background: var(--tool-accent, #3b82f6);
        border-color: var(--tool-accent, #3b82f6);
        color: #ffffff;
      }
      .sw-url-modal-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }
      .sw-url-modal {
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 10px;
        padding: 20px;
        width: 90%;
        max-width: 460px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      }
      .sw-url-modal input {
        width: 100%;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 8px 12px;
        color: #f8fafc;
        font-size: 0.88rem;
        margin: 12px 0 16px 0;
        box-sizing: border-box;
      }
      .sw-url-modal input:focus {
        outline: none;
        border-color: #3b82f6;
      }
    `;
    document.head.appendChild(style);
  }

  private _bindEvents(): void {
    // Buttons
    const btnFile = this._root.querySelector<HTMLButtonElement>(".sw-btn-file")!;
    const btnFolder = this._root.querySelector<HTMLButtonElement>(".sw-btn-folder")!;
    const btnUrl = this._root.querySelector<HTMLButtonElement>(".sw-btn-url")!;
    const btnPaste = this._root.querySelector<HTMLButtonElement>(".sw-btn-paste")!;

    btnFile.addEventListener("click", (e) => {
      e.stopPropagation();
      this._fileInput.click();
    });

    btnFolder.addEventListener("click", (e) => {
      e.stopPropagation();
      this._folderInput.click();
    });

    btnUrl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.promptUrlModal();
    });

    btnPaste.addEventListener("click", async (e) => {
      e.stopPropagation();
      await this.triggerClipboardPaste();
    });

    // Inputs change
    this._fileInput.addEventListener("change", () => {
      if (this._fileInput.files && this._fileInput.files.length > 0) {
        const files = Array.from(this._fileInput.files);
        this._fileInput.value = "";
        this._handleFiles(files);
      }
    });

    this._folderInput.addEventListener("change", () => {
      if (this._folderInput.files && this._folderInput.files.length > 0) {
        const files = Array.from(this._folderInput.files);
        this._folderInput.value = "";
        this._handleFiles(files);
      }
    });

    // Drag & Drop on Dropzone Element
    this._root.addEventListener("dragenter", (e) => {
      e.preventDefault();
      this._dragDepth++;
      this._root.classList.add("drag-active");
    });

    this._root.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });

    this._root.addEventListener("dragleave", (e) => {
      e.preventDefault();
      this._dragDepth = Math.max(0, this._dragDepth - 1);
      if (this._dragDepth === 0) {
        this._root.classList.remove("drag-active");
      }
    });

    this._root.addEventListener("drop", (e) => {
      e.preventDefault();
      // Keep window-level drop handlers of the host page from importing the same drop a second time
      e.stopPropagation();
      this._dragDepth = 0;
      this._root.classList.remove("drag-active");
      if (e.dataTransfer) {
        this._handleDataTransfer(e.dataTransfer);
      }
    });

    // Window-wide drop & paste
    if (this._options.enableWindowDrop !== false) {
      const onWinDragOver = (e: DragEvent): void => e.preventDefault();
      const onWinDrop = (e: DragEvent): void => {
        // Only handle if dropped outside dropzone (dropzone handles its own)
        if (this._root.contains(e.target as Node)) return;
        if (!isActiveToolHost(this._root)) return;
        if (e.dataTransfer && e.dataTransfer.files.length > 0) {
          e.preventDefault();
          this._handleDataTransfer(e.dataTransfer);
        }
      };

      window.addEventListener("dragover", onWinDragOver);
      window.addEventListener("drop", onWinDrop);

      this._disposers.push(() => {
        window.removeEventListener("dragover", onWinDragOver);
        window.removeEventListener("drop", onWinDrop);
      });
    }

    if (this._options.enablePaste !== false) {
      const onPaste = (e: ClipboardEvent): void => {
        if (!isActiveToolHost(this._root)) return;
        // Forge routes pasted images to its topmost window itself
        if (
          null !== this._root.closest(".swf-window") &&
          Array.from(e.clipboardData?.items ?? []).some((item) => item.type.startsWith("image/"))
        ) {
          return;
        }
        // If user is currently typing in an input or textarea, let it type
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
          target !== this._fileInput
        ) {
          return;
        }
        if (e.clipboardData) {
          this._handleClipboardData(e.clipboardData);
        }
      };

      window.addEventListener("paste", onPaste);
      this._disposers.push(() => window.removeEventListener("paste", onPaste));
    }
  }

  public promptUrlModal(): void {
    const overlay = document.createElement("div");
    overlay.className = "sw-url-modal-overlay";
    overlay.innerHTML = `
      <div class="sw-url-modal">
        <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.95rem; color: #f8fafc;">
          <span class="sw-dropzone-icon">${ICONS.link}</span>Von URL laden
        </div>
        <input type="url" placeholder="https://… oder Data-URI" autofocus />
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button type="button" class="sw-dropzone-btn sw-btn-cancel">Abbrechen</button>
          <button type="button" class="sw-dropzone-btn sw-btn-confirm" style="background:#3b82f6;border-color:#3b82f6;color:#fff;">Laden</button>
        </div>
      </div>
    `;

    const input = overlay.querySelector<HTMLInputElement>("input")!;
    const btnCancel = overlay.querySelector<HTMLButtonElement>(".sw-btn-cancel")!;
    const btnConfirm = overlay.querySelector<HTMLButtonElement>(".sw-btn-confirm")!;

    const close = (): void => overlay.remove();
    btnCancel.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    const submit = async (): Promise<void> => {
      const url = input.value.trim();
      if (!url) return;
      close();
      try {
        const result = await this._router.routeText(url);
        await this._options.onIngest(result);
      } catch (err) {
        this._handleError(err);
      }
    };

    btnConfirm.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submit();
      if (e.key === "Escape") close();
    });

    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 50);
  }

  public async triggerClipboardPaste(): Promise<void> {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith("image/")) {
              const blob = await item.getType(type);
              const file = new File([blob], "clipboard_image.png", { type });
              await this._handleFiles([file]);
              return;
            }
          }
        }
      }

      // Text fallback
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          const result = await this._router.routeText(text.trim(), "clipboard");
          await this._options.onIngest(result);
          return;
        }
      }
    } catch {
      // Fallback: prompt modal
      this.promptUrlModal();
    }
  }

  private async _handleFiles(files: File[]): Promise<void> {
    try {
      const result = await this._router.routeFiles(files);
      await this._options.onIngest(result);
    } catch (err) {
      this._handleError(err);
    }
  }

  private async _handleDataTransfer(dataTransfer: DataTransfer): Promise<void> {
    try {
      const result = await this._router.routeDataTransfer(dataTransfer);
      await this._options.onIngest(result);
    } catch (err) {
      this._handleError(err);
    }
  }

  private async _handleClipboardData(clipboardData: DataTransfer): Promise<void> {
    // 1. Files in clipboard (e.g. screenshot)
    if (clipboardData.files && clipboardData.files.length > 0) {
      const files = Array.from(clipboardData.files);
      await this._handleFiles(files);
      return;
    }

    // 2. Text in clipboard
    const text = clipboardData.getData("text/plain");
    if (text && text.trim()) {
      try {
        const result = await this._router.routeText(text.trim(), "clipboard");
        await this._options.onIngest(result);
      } catch (err) {
        this._handleError(err);
      }
    }
  }

  private _handleError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this._options.onError) {
      this._options.onError(error);
    } else {
      console.error("[UniversalIngestDropzone]", error);
      alert(`Fehler beim Import: ${error.message}`);
    }
  }
}
