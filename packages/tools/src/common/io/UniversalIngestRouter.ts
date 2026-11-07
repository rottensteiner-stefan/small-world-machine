import { matchPbrSlots } from "./PbrSlotMatcher.js";
import { ArchiveDecompressor } from "./ArchiveDecompressor.js";
import { ZipAssetSource } from "./sources/ZipAssetSource.js";
import { FileAssetSource } from "./sources/FileAssetSource.js";
import type { IngestResult } from "./UniversalIngestTypes.js";
import { normalizeSvg } from "./svgNormalize.js";

/** Default longer edge (px) an SVG is sized to, so vector input yields a useful bitmap size. */
const DEFAULT_SVG_LONG_EDGE = 1024;

const FETCH_TIMEOUT_MS = 60_000;

export interface IngestRouterOptions {
  preferredKind?: "image" | "svg" | "pbr-set" | "gltf" | "json" | "archive" | "any";
  onProgress?: (msg: string) => void;
  /** Longer edge in px that SVGs are sized to (default 1024); 0 keeps the SVG's intrinsic size. */
  svgLongEdge?: number;
}

export class UniversalIngestRouter {
  private readonly _decompressor = new ArchiveDecompressor();
  private readonly _options: IngestRouterOptions;

  constructor(options: IngestRouterOptions = {}) {
    this._options = options;
  }

  /**
   * Routes a list of File objects into a structured IngestResult.
   */
  public async routeFiles(files: File[]): Promise<IngestResult> {
    if (files.length === 0) {
      throw new Error("Keine Dateien übergeben.");
    }

    // 1. Single file routing
    const [onlyFile] = files;
    if (1 === files.length && undefined !== onlyFile) {
      return this.routeSingleFile(onlyFile);
    }

    // 2. Multi-file check: Check if files form a PBR material set
    const pbrMatch = matchPbrSlots(files.map((f) => ({ name: f.name, blob: f })));
    if (pbrMatch) {
      return {
        kind: "pbr-set",
        pbrSet: pbrMatch,
        name: pbrMatch.name,
      };
    }

    // 3. Multi-file check: glTF bundle with .gltf + .bin + textures
    const gltfMain = files.find(
      (f) => f.name.toLowerCase().endsWith(".gltf") || f.name.toLowerCase().endsWith(".glb"),
    );
    if (gltfMain) {
      const source = new FileAssetSource(
        files.map((file) => ({ path: file.webkitRelativePath || file.name, file })),
      );
      return {
        kind: "gltf",
        source,
        mainFile: gltfMain.name,
        name: gltfMain.name.replace(/\.[^/.]+$/, ""),
      };
    }

    // Default multi-file fallback
    return {
      kind: "files",
      files,
      name: `${files.length} Dateien`,
    };
  }

  /**
   * Routes a single File.
   */
  public async routeSingleFile(file: File): Promise<IngestResult> {
    const filename = file.name.toLowerCase();

    // Archive: .zip
    if (filename.endsWith(".zip")) {
      return this.routeZipArchive(file, file.name);
    }

    // Archive: .gz (e.g. .json.gz, .svg.gz, .tar.gz)
    if (filename.endsWith(".gz")) {
      const uncompressed = await this._decompressor.decompressGzip(file, file.name);
      return this.routeRawData(uncompressed.data, uncompressed.name, uncompressed.mimeType);
    }

    // glTF / GLB 3D model
    if (filename.endsWith(".gltf") || filename.endsWith(".glb")) {
      const source = new FileAssetSource([{ path: file.name, file }]);
      return {
        kind: "gltf",
        source,
        mainFile: file.name,
        name: file.name.replace(/\.[^/.]+$/, ""),
      };
    }

    // SVG (vector): keep the source and give it an explicit pixel size
    if (file.type === "image/svg+xml" || /\.svg$/i.test(filename)) {
      return this._buildSvgResult(await file.text(), file.name);
    }

    // Image
    if (file.type.startsWith("image/") || /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(filename)) {
      const img = await this._loadImageFromBlob(file);
      const dataUrl = await this._blobToDataUrl(file);
      return {
        kind: "image",
        image: img,
        blob: file,
        dataUrl,
        name: file.name,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      };
    }

    // JSON
    if (file.type === "application/json" || filename.endsWith(".json")) {
      const text = await file.text();
      try {
        const data = JSON.parse(text) as unknown;
        return {
          kind: "json",
          data,
          rawText: text,
          name: file.name,
        };
      } catch {
        return {
          kind: "text",
          text,
          name: file.name,
        };
      }
    }

    // Text / Code
    const text = await file.text();
    return {
      kind: "text",
      text,
      name: file.name,
    };
  }

  /**
   * Routes a ZIP archive.
   */
  public async routeZipArchive(
    buffer: Uint8Array | ArrayBuffer | Blob,
    archiveName: string,
  ): Promise<IngestResult> {
    const items = await this._decompressor.unpackZip(buffer);
    if (items.length === 0) {
      throw new Error(`Das Archiv '${archiveName}' ist leer.`);
    }

    // Check for glTF inside zip
    const gltfEntry = items.find(
      (i) => i.name.toLowerCase().endsWith(".gltf") || i.name.toLowerCase().endsWith(".glb"),
    );
    if (gltfEntry) {
      const zipSource = ZipAssetSource.fromEntries(items, { name: archiveName });
      return {
        kind: "gltf",
        source: zipSource,
        mainFile: gltfEntry.path,
        name: gltfEntry.name.replace(/\.[^/.]+$/, ""),
      };
    }

    // Check for PBR set inside zip
    const pbrMatch = matchPbrSlots(items.map((i) => ({ name: i.name, blob: i.blob })));
    if (pbrMatch) {
      return {
        kind: "pbr-set",
        pbrSet: pbrMatch,
        name: pbrMatch.name || archiveName.replace(/\.zip$/i, ""),
      };
    }

    // Check if zip contains only 1 image
    const images = items.filter((i) => i.mimeType.startsWith("image/"));
    const [onlyImage] = images;
    if (1 === images.length && items.length <= 2 && undefined !== onlyImage) {
      const img = await this._loadImageFromBlob(onlyImage.blob);
      const dataUrl = await this._blobToDataUrl(onlyImage.blob);
      return {
        kind: "image",
        image: img,
        blob: onlyImage.blob,
        dataUrl,
        name: onlyImage.name,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      };
    }

    return {
      kind: "archive",
      files: items,
      name: archiveName,
    };
  }

  /**
   * Routes raw string text (SVG, JSON, URL, Base64 Data URL, or plain text).
   */
  public async routeText(rawText: string, fallbackName = "clipboard_input"): Promise<IngestResult> {
    const trimmed = rawText.trim();

    // 1a. SVG Data URL (data:image/svg+xml;...)
    if (/^data:image\/svg\+xml/i.test(trimmed)) {
      const res = await fetch(trimmed, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return this._buildSvgResult(await res.text(), `${fallbackName}.svg`);
    }

    // 1. Data URL (e.g. data:image/png;base64,...)
    if (trimmed.startsWith("data:image/")) {
      const res = await fetch(trimmed, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      const blob = await res.blob();
      const img = await this._loadImageFromBlob(blob);
      return {
        kind: "image",
        image: img,
        blob,
        dataUrl: trimmed,
        name: `${fallbackName}.png`,
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
      };
    }

    // 2. HTTP / HTTPS / File URL
    if (/^https?:\/\//i.test(trimmed) || /^file:\/\/\//i.test(trimmed)) {
      return this.routeUrl(trimmed);
    }

    // 3. Raw SVG code
    if (trimmed.startsWith("<svg") || (trimmed.startsWith("<?xml") && trimmed.includes("<svg"))) {
      return this._buildSvgResult(trimmed, `${fallbackName}.svg`);
    }

    // 4. Raw JSON
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const data = JSON.parse(trimmed) as unknown;
        return {
          kind: "json",
          data,
          rawText: trimmed,
          name: `${fallbackName}.json`,
        };
      } catch {
        // Fall through to plain text
      }
    }

    // 5. Plain text
    return {
      kind: "text",
      text: trimmed,
      name: `${fallbackName}.txt`,
    };
  }

  /**
   * Fetches and routes a URL.
   */
  public async routeUrl(url: string): Promise<IngestResult> {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} beim Laden von ${url}: ${res.statusText}`);
    }

    const blob = await res.blob();
    const urlFilename = url.split("?")[0]?.split("/").pop() || "downloaded_asset";
    const file = new File([blob], urlFilename, { type: blob.type });

    return this.routeSingleFile(file);
  }

  /**
   * Routes a DataTransfer from a drag & drop event (recursively scanning folders).
   */
  public async routeDataTransfer(dataTransfer: DataTransfer): Promise<IngestResult> {
    const files: File[] = [];

    // Check for webkitGetAsEntry (Folder & File traversal)
    if (dataTransfer.items && dataTransfer.items.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < dataTransfer.items.length; i++) {
        const item = dataTransfer.items[i];
        if (undefined !== item && "function" === typeof item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }

      if (entries.length > 0) {
        for (const entry of entries) {
          await this._scanFileSystemEntry(entry, files);
        }
      }
    }

    // Fallback to dataTransfer.files
    if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const droppedFile = dataTransfer.files[i];
        if (undefined !== droppedFile) files.push(droppedFile);
      }
    }

    if (files.length > 0) {
      return this.routeFiles(files);
    }

    // Check for text / URL drag
    const textData = dataTransfer.getData("text/uri-list") || dataTransfer.getData("text/plain");
    if (textData) {
      return this.routeText(textData, "dragged_input");
    }

    throw new Error(
      "Es konnten keine verwertbaren Dateien oder Inhalte im Drop-Event gefunden werden.",
    );
  }

  /**
   * Routes raw uncompressed bytes with a known filename.
   */
  public async routeRawData(
    data: Uint8Array,
    filename: string,
    mimeType: string,
  ): Promise<IngestResult> {
    const blob = new Blob([data as BlobPart], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });
    return this.routeSingleFile(file);
  }

  private async _scanFileSystemEntry(entry: FileSystemEntry, result: File[]): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      await new Promise<void>((resolve) => {
        fileEntry.file(
          (f) => {
            result.push(f);
            resolve();
          },
          () => resolve(),
        );
      });
    } else if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const readEntries = async (): Promise<void> => {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => {
          reader.readEntries(
            (entries) => resolve(entries),
            () => resolve([]),
          );
        });
        if (batch.length > 0) {
          for (const sub of batch) {
            await this._scanFileSystemEntry(sub, result);
          }
          await readEntries(); // Continue reading until empty
        }
      };
      await readEntries();
    }
  }

  /** Sizes an SVG explicitly (see `normalizeSvg`) and wraps it as an `svg` ingest result. */
  private _buildSvgResult(source: string, name: string): IngestResult {
    const normalized = normalizeSvg(source, this._options.svgLongEdge ?? DEFAULT_SVG_LONG_EDGE);
    return {
      kind: "svg",
      svgText: normalized.text,
      blob: new Blob([normalized.text], { type: "image/svg+xml" }),
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized.text)}`,
      name,
      width: normalized.width,
      height: normalized.height,
    };
  }

  private _loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = (): void => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (): void => {
        URL.revokeObjectURL(url);
        reject(
          new Error(
            "Bild konnte nicht geladen werden. Format wird möglicherweise nicht unterstützt.",
          ),
        );
      };
      img.src = url;
    });
  }

  private _blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => resolve(reader.result as string);
      reader.onerror = (): void =>
        reject(new Error("Fehler beim Konvertieren der Datei in Base64."));
      reader.readAsDataURL(blob);
    });
  }
}
