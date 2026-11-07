export type IngestMode = "file" | "url" | "text";

export interface UnifiedIngestPanelOptions {
  container: HTMLElement;
  modes?: IngestMode[];
  defaultMode?: IngestMode;
  variant?: "standard" | "compact" | "hero";

  // File options
  fileLabel?: string;
  fileSub?: string;
  fileAccept?: string;
  onFile?: (file: File) => void | Promise<void>;
  onFiles?: (files: File[]) => void | Promise<void>;

  // URL options
  urlPlaceholder?: string;
  urlButtonLabel?: string;
  onUrl?: (url: string) => void | Promise<void>;

  // Text options
  textPlaceholder?: string;
  textButtonLabel?: string;
  onText?: (text: string) => void | Promise<void>;

  // Global / Container Paste
  enablePaste?: boolean;

  // Error handler
  onError?: (error: Error) => void;
}

/**
 * Unified multi-modal input component supporting File Drop/Pick, URL Fetch, and Raw Text/Code.
 */
export class UnifiedIngestPanel {
  private readonly _options: UnifiedIngestPanelOptions;
  private readonly _root: HTMLElement;
  private readonly _fileInput: HTMLInputElement;
  private _activeMode: IngestMode;
  private readonly _disposers: (() => void)[] = [];

  constructor(options: UnifiedIngestPanelOptions) {
    this._options = options;
    const modes = options.modes ?? ["file", "url", "text"];
    this._activeMode = options.defaultMode ?? modes[0] ?? "file";

    this._root = document.createElement("div");
    this._root.className = `dropzone-container${options.variant ? ` ${options.variant}` : ""}`;

    // Invisible file input
    this._fileInput = document.createElement("input");
    this._fileInput.type = "file";
    if (options.fileAccept) this._fileInput.accept = options.fileAccept;
    this._fileInput.style.display = "none";
    this._root.appendChild(this._fileInput);

    this._buildUI(modes);
    this._bindEvents();
    options.container.appendChild(this._root);
  }

  public get element(): HTMLElement {
    return this._root;
  }

  public get activeMode(): IngestMode {
    return this._activeMode;
  }

  public setMode(mode: IngestMode): void {
    this._activeMode = mode;
    const tabs = this._root.querySelectorAll<HTMLButtonElement>(".dropzone-tab");
    tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset["mode"] === mode);
    });

    const panels = this._root.querySelectorAll<HTMLElement>(".dropzone-panel");
    panels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset["mode"] === mode);
    });
  }

  public dispose(): void {
    this._disposers.forEach((d) => d());
    this._disposers.length = 0;
    this._root.remove();
  }

  private _buildUI(modes: IngestMode[]): void {
    if (modes.length > 1) {
      const tabNav = document.createElement("div");
      tabNav.className = "dropzone-tabs";

      const modeLabels: Record<IngestMode, { label: string; icon: string }> = {
        file: { label: "Datei", icon: "📁" },
        url: { label: "URL", icon: "🌐" },
        text: { label: "Direkt / Code", icon: "📋" },
      };

      for (const mode of modes) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `dropzone-tab${mode === this._activeMode ? " active" : ""}`;
        btn.dataset["mode"] = mode;
        btn.innerHTML = `<span>${modeLabels[mode].icon}</span> <span>${modeLabels[mode].label}</span>`;
        btn.addEventListener("click", () => this.setMode(mode));
        tabNav.appendChild(btn);
      }
      this._root.appendChild(tabNav);
    }

    // Panel: File Drop
    if (modes.includes("file")) {
      const filePanel = document.createElement("div");
      filePanel.className = `dropzone-panel${this._activeMode === "file" ? " active" : ""}`;
      filePanel.dataset["mode"] = "file";

      const variantClass = this._options.variant ? ` ${this._options.variant}` : "";
      filePanel.innerHTML = `
        <div class="dropzone${variantClass}">
          <svg class="dropzone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <div class="dropzone-text">${this._options.fileLabel ?? "Datei hier ablegen oder klicken"}</div>
          <div class="dropzone-sub">${this._options.fileSub ?? "Drag & Drop oder Dateidialog öffnen"}</div>
        </div>
      `;

      const dropTarget = filePanel.querySelector(".dropzone") as HTMLElement;
      dropTarget.addEventListener("click", () => this._fileInput.click());
      this._setupDragDrop(dropTarget);

      this._root.appendChild(filePanel);
    }

    // Panel: URL
    if (modes.includes("url")) {
      const urlPanel = document.createElement("div");
      urlPanel.className = `dropzone-panel${this._activeMode === "url" ? " active" : ""}`;
      urlPanel.dataset["mode"] = "url";

      const row = document.createElement("div");
      row.className = "dropzone-input-row";

      const input = document.createElement("input");
      input.type = "url";
      input.className = "dropzone-input";
      input.placeholder = this._options.urlPlaceholder ?? "https://example.com/asset.json";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dropzone-btn";
      btn.textContent = this._options.urlButtonLabel ?? "Laden";

      const handleUrlSubmit = (): void => {
        const val = input.value.trim();
        if (!val) return;
        try {
          const res = this._options.onUrl?.(val);
          if (res instanceof Promise) {
            res.catch((err) => this._handleError(err));
          }
        } catch (err) {
          this._handleError(err);
        }
      };

      btn.addEventListener("click", handleUrlSubmit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleUrlSubmit();
        }
      });

      row.appendChild(input);
      row.appendChild(btn);
      urlPanel.appendChild(row);
      this._root.appendChild(urlPanel);
    }

    // Panel: Text
    if (modes.includes("text")) {
      const textPanel = document.createElement("div");
      textPanel.className = `dropzone-panel${this._activeMode === "text" ? " active" : ""}`;
      textPanel.dataset["mode"] = "text";

      const textarea = document.createElement("textarea");
      textarea.className = "dropzone-textarea";
      textarea.placeholder =
        this._options.textPlaceholder ?? "JSON, GeoJSON, ASCII-Map oder Code hier einfügen…";

      const row = document.createElement("div");
      row.className = "dropzone-input-row";
      row.style.justifyContent = "flex-end";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dropzone-btn";
      btn.textContent = this._options.textButtonLabel ?? "Anwenden";

      btn.addEventListener("click", () => {
        const val = textarea.value.trim();
        if (!val) return;
        try {
          const res = this._options.onText?.(val);
          if (res instanceof Promise) {
            res.catch((err) => this._handleError(err));
          }
        } catch (err) {
          this._handleError(err);
        }
      });

      row.appendChild(btn);
      textPanel.appendChild(textarea);
      textPanel.appendChild(row);
      this._root.appendChild(textPanel);
    }
  }

  private _bindEvents(): void {
    // File input change
    const onFileInputChange = (): void => {
      const files = this._fileInput.files;
      if (!files || files.length === 0) return;
      this._handleFiles(Array.from(files));
      this._fileInput.value = "";
    };
    this._fileInput.addEventListener("change", onFileInputChange);
    this._disposers.push(() => this._fileInput.removeEventListener("change", onFileInputChange));

    // Optional Clipboard Paste Listener
    if (this._options.enablePaste) {
      const onPaste = (e: ClipboardEvent): void => {
        // If the user is currently typing in an input or textarea, let default behavior occur
        const active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
          return;
        }

        const items = e.clipboardData?.items;
        if (!items) return;

        // Check for files first
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item?.kind === "file") {
            const file = item.getAsFile();
            if (file) {
              e.preventDefault();
              this._handleFiles([file]);
              return;
            }
          }
        }

        // Check for text/code
        const text = e.clipboardData?.getData("text");
        if (text && text.trim()) {
          if (this._options.onText) {
            e.preventDefault();
            try {
              const res = this._options.onText(text.trim());
              if (res instanceof Promise) {
                res.catch((err) => this._handleError(err));
              }
            } catch (err) {
              this._handleError(err);
            }
          }
        }
      };

      window.addEventListener("paste", onPaste);
      this._disposers.push(() => window.removeEventListener("paste", onPaste));
    }
  }

  private _setupDragDrop(target: HTMLElement): void {
    let depth = 0;

    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault();
      depth++;
      target.classList.add("dragover");
    };

    const onDragOver = (e: DragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent): void => {
      e.preventDefault();
      depth = Math.max(0, depth - 1);
      if (depth === 0) target.classList.remove("dragover");
    };

    const onDrop = (e: DragEvent): void => {
      e.preventDefault();
      depth = 0;
      target.classList.remove("dragover");
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this._handleFiles(Array.from(files));
      }
    };

    target.addEventListener("dragenter", onDragEnter);
    target.addEventListener("dragover", onDragOver);
    target.addEventListener("dragleave", onDragLeave);
    target.addEventListener("drop", onDrop);

    this._disposers.push(() => {
      target.removeEventListener("dragenter", onDragEnter);
      target.removeEventListener("dragover", onDragOver);
      target.removeEventListener("dragleave", onDragLeave);
      target.removeEventListener("drop", onDrop);
    });
  }

  private _handleFiles(files: File[]): void {
    try {
      if (this._options.onFiles) {
        const res = this._options.onFiles(files);
        if (res instanceof Promise) res.catch((err) => this._handleError(err));
      } else if (this._options.onFile && files.length > 0) {
        const res = this._options.onFile(files[0]!);
        if (res instanceof Promise) res.catch((err) => this._handleError(err));
      }
    } catch (err) {
      this._handleError(err);
    }
  }

  private _handleError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    if (this._options.onError) {
      this._options.onError(error);
    } else {
      console.error("[UnifiedIngestPanel]", error);
    }
  }
}
