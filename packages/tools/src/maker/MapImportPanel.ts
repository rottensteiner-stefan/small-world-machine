import { UnifiedIngestPanel } from "../common/io/ui/UnifiedIngestPanel.js";

/**
 * UI for Maker's "Import ASCII Map" bridge to `GridLevelBuilder` (see
 * docs/adr/0010-maker-editor-architecture.md Phase 2C).
 * Supports Direct Text Paste, File Drop (.map/.txt), and URL Fetch.
 */
export class MapImportPanel {
  private readonly _panel: UnifiedIngestPanel;

  constructor(container: HTMLElement, onImport: (mapData: string) => void) {
    const heading = document.createElement("h4");
    heading.className = "maker-palette-section";
    heading.textContent = "Import ASCII Map";
    container.appendChild(heading);

    const mountPoint = document.createElement("div");
    container.appendChild(mountPoint);

    this._panel = new UnifiedIngestPanel({
      container: mountPoint,
      modes: ["text", "file", "url"],
      defaultMode: "text",
      variant: "compact",
      fileLabel: "Map Datei ablegen",
      fileSub: ".txt, .map oder .json",
      fileAccept: ".txt,.map,.json",
      urlPlaceholder: "https://.../map.txt",
      textPlaceholder: "MapGenerator ASCII-Map hier einfügen…",
      textButtonLabel: "⌗ Import",
      onText: (text: string): void => onImport(text),
      onFile: async (file: File): Promise<void> => {
        const text = await file.text();
        onImport(text);
      },
      onUrl: async (url: string): Promise<void> => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        onImport(text);
      },
    });
  }

  public dispose(): void {
    this._panel.dispose();
  }
}
