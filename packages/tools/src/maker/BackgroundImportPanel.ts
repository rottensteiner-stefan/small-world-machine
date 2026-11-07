import { UniversalIngestDropzone } from "../common/io/ui/UniversalIngestDropzone.js";
import { UniversalIngestRouter } from "../common/io/UniversalIngestRouter.js";
import type { IngestResult } from "../common/io/UniversalIngestTypes.js";
import {
  primaryPbrTexture,
  textureName,
  firstImageItem,
} from "../common/io/ingestResultHelpers.js";

/** Draws an SVG blob onto a canvas of the given size and returns it as a PNG file. */
async function rasterizeSvg(svg: Blob, width: number, height: number, name: string): Promise<File> {
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (null === ctx) throw new Error("2D-Kontext nicht verfügbar.");
    ctx.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (null === png) throw new Error("PNG-Export fehlgeschlagen.");
    return new File([png], `${name.replace(/\.svg$/i, "")}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * UI for importing a reference image to trace 2.5D stage zones on top of (ADR 0016 Phase
 * 2) -- uses UniversalIngestDropzone with file picker, folder scan, URL fetch, and paste,
 * plus direct drag & drop onto the viewport canvas.
 */
export class BackgroundImportPanel {
  private readonly _dropzone: UniversalIngestDropzone;

  constructor(container: HTMLElement, viewportCanvas: HTMLElement, onImport: (file: File) => void) {
    const heading = document.createElement("h4");
    heading.className = "maker-palette-section";
    heading.textContent = "Background Reference";
    container.appendChild(heading);

    const mountPoint = document.createElement("div");
    mountPoint.style.marginBottom = "0.75rem";
    container.appendChild(mountPoint);

    const toFile = (blob: Blob, name: string): File =>
      blob instanceof File ? blob : new File([blob], name, { type: blob.type || "image/png" });

    const handleResult = (result: IngestResult): void => {
      if ("svg" === result.kind) {
        // createImageBitmap cannot decode SVG blobs, so rasterise to PNG first
        void rasterizeSvg(result.blob, result.width, result.height, result.name)
          .then(onImport)
          .catch((err: Error): void => {
            console.error("[Maker BackgroundImport] SVG-Rasterisierung fehlgeschlagen:", err);
          });
      } else if ("image" === result.kind) {
        const file =
          result.blob instanceof File
            ? result.blob
            : new File([result.blob], result.name || "background_ref.png", {
                type: result.blob.type || "image/png",
              });
        onImport(file);
      } else if (result.kind === "pbr-set") {
        const primary = primaryPbrTexture(result.pbrSet);
        if (primary) {
          onImport(toFile(primary, textureName(primary, result.name)));
        }
      } else if (result.kind === "archive" || result.kind === "files") {
        const img = firstImageItem(result);
        if (img) {
          onImport(toFile(img.blob, img.name));
        }
      }
    };

    this._dropzone = new UniversalIngestDropzone({
      container: mountPoint,
      label: "Referenzbild ablegen",
      supportedKinds: ["image", "svg", "pbr-set", "zip", "files"],
      enableWindowDrop: false,
      enablePaste: true,
      onIngest: handleResult,
      onError: (err: Error): void => {
        console.error("[Maker BackgroundImport] Ingest Fehler:", err);
      },
    });

    viewportCanvas.addEventListener("dragover", (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    });
    viewportCanvas.addEventListener("drop", (e: DragEvent): void => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      if ("image/svg+xml" === file.type || /\.svg$/i.test(file.name)) {
        e.preventDefault();
        void new UniversalIngestRouter()
          .routeSingleFile(file)
          .then(handleResult)
          .catch((err: Error): void => {
            console.error("[Maker BackgroundImport] Ingest Fehler:", err);
          });
        return;
      }
      if (!file.type.startsWith("image/")) return;
      e.preventDefault();
      onImport(file);
    });
  }

  public dispose(): void {
    this._dropzone.dispose();
  }
}
