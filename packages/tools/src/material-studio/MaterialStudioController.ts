import type { MaterialStudioApp } from "../MaterialStudio.js";
import { NormalMapFormat } from "@small-world-machine/engine";
import {
  derivePbrMaps,
  MATERIAL_STUDIO_PRESETS,
  type MaterialStudioMapParams,
} from "../core/material.js";
import { UniversalIngestDropzone } from "../common/io/ui/UniversalIngestDropzone.js";
import type { IngestResult } from "../common/io/UniversalIngestTypes.js";
import {
  primaryPbrTexture,
  textureName,
  firstImageItem,
} from "../common/io/ingestResultHelpers.js";

// The pure derivation + presets live headless in `core/material.ts` (single source for
// web UI and future `swm material gen`). These aliases keep the UI-side naming local.
type MaterialStudioPreset = MaterialStudioMapParams;
const PRESETS = MATERIAL_STUDIO_PRESETS;

type MaterialStudioMapKey =
  "original" | "height" | "normal" | "specular" | "roughness" | "ao" | "edge";

/**
 * Owns every piece of DOM-bound PBR-Studio behaviour that used to live in `MaterialStudio._bindLogic()`:
 * preset/slider/tab wiring, drag & drop image intake, PBR map generation via `TextureFilters`, and pushing
 * the result into the 3D preview. Kept as a single class rather than split further because every part
 * shares the same mutable session state (loaded image, active tab, offscreen canvases).
 */
export class MaterialStudioController {
  private _app: MaterialStudioApp | null = null;
  private _onBase64Image: ((b64: string) => void) | null = null;

  public setApp(app: MaterialStudioApp | null): void {
    this._app = app;
  }

  public onPasteImage(base64: string): void {
    if (this._onBase64Image) {
      this._onBase64Image(base64);
    }
  }

  public bind(): void {
    try {
      const originalImage = new Image();
      let originalFileName = "rock";
      let loadedData: ImageData | null = null;
      let activeTab = "grid";
      let isProcessing = false;
      let needsUpdate = false;

      const canvases: Record<MaterialStudioMapKey, HTMLCanvasElement> = {
        original: document.createElement("canvas"),
        height: document.createElement("canvas"),
        normal: document.createElement("canvas"),
        specular: document.createElement("canvas"),
        roughness: document.createElement("canvas"),
        ao: document.createElement("canvas"),
        edge: document.createElement("canvas"),
      };

      const displays: Record<MaterialStudioMapKey | "preview", HTMLElement | null> = {
        original: document.getElementById("canvas-grid-original"),
        height: document.getElementById("canvas-grid-height"),
        normal: document.getElementById("canvas-grid-normal"),
        specular: document.getElementById("canvas-grid-specular"),
        roughness: document.getElementById("canvas-grid-roughness"),
        ao: document.getElementById("canvas-grid-ao"),
        edge: document.getElementById("canvas-grid-edge"),
        preview: document.getElementById("canvas-main-preview"),
      };

      document.querySelectorAll(".collapsible-header").forEach((header) => {
        header.addEventListener("click", () => {
          header.classList.toggle("active");
          const targetId = header.getAttribute("data-target") || "";
          const content = document.getElementById(targetId);
          if (content) content.classList.toggle("open");
        });
      });

      const dropzoneContainer =
        document.getElementById("materialstudio-dropzone-container") ||
        document.getElementById("dropzone");
      if (dropzoneContainer) {
        new UniversalIngestDropzone({
          container: dropzoneContainer,
          label: "Textur ablegen",
          supportedKinds: ["image", "pbr-set", "zip", "files", "svg", "text"],
          enableWindowDrop: true,
          enablePaste: true,
          onIngest: async (result: IngestResult): Promise<void> => {
            const loadingText = document.getElementById("loading-text");
            if (loadingText) loadingText.innerText = "Lade Textur...";
            const loadingOverlay = document.getElementById("loading-overlay");
            if (loadingOverlay) loadingOverlay.classList.add("active");

            if (result.kind === "image") {
              originalFileName = result.name.split(".")[0] || "custom";
              originalImage.src = result.dataUrl;
            } else if (result.kind === "pbr-set") {
              const primary = primaryPbrTexture(result.pbrSet);
              if (primary) {
                originalFileName = textureName(primary, result.name).split(".")[0] || "pbr_texture";
                originalImage.src = URL.createObjectURL(primary);
              }
            } else if (result.kind === "archive" || result.kind === "files") {
              const img = firstImageItem(result);
              if (img) {
                originalFileName = img.name.split(".")[0] || "custom";
                originalImage.src = URL.createObjectURL(img.blob);
              }
            } else if (result.kind === "svg") {
              originalFileName = "vector_texture";
              originalImage.src = URL.createObjectURL(result.blob);
            } else if (result.kind === "text") {
              if (result.text.startsWith("data:image/")) {
                originalFileName = "pasted_image";
                originalImage.src = result.text;
              }
            }
          },
          onError: (err: Error): void => {
            console.error("MaterialStudio Ingest Error:", err);
            alert("Fehler beim Importieren: " + err.message);
          },
        });
      }

      this._onBase64Image = (b64: string): void => {
        originalFileName = "pasted_image";
        const loadingText = document.getElementById("loading-text");
        if (loadingText) loadingText.innerText = "Loading pasted image...";
        const loadingOverlay = document.getElementById("loading-overlay");
        if (loadingOverlay) loadingOverlay.classList.add("active");
        originalImage.src = b64;
      };

      // Load standard rock image from public files
      originalImage.onload = (): void => {
        initializeImageData();
      };
      originalImage.onerror = (): void => {
        // Fallback: draw a noise pattern if the file doesn't load
        createProceduralFallback();
      };
      // Load rock texture
      originalImage.src = "/apps/showcases/10/assets/rock.webp";

      function createProceduralFallback(): void {
        // Simple canvas fallback texture (256x256 simple rock noise)
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          for (let y = 0; y < 256; y++) {
            for (let x = 0; x < 256; x++) {
              const v = Math.floor(
                128 + Math.sin(x * 0.1) * 30 + Math.cos(y * 0.1) * 30 + Math.random() * 20,
              );
              // tool-theme: allow generated-texture
              ctx.fillStyle = `rgb(${v},${v - 10},${v - 20})`;
              ctx.fillRect(x, y, 1, 1);
            }
          }
        }
        originalFileName = "procedural_fallback";
        originalImage.src = canvas.toDataURL();
      }

      function initializeImageData(): void {
        const maxRes = (document.getElementById("export-size") as HTMLInputElement).value;
        let w = originalImage.naturalWidth;
        let h = originalImage.naturalHeight;

        if (maxRes !== "original") {
          const sizeLimit = parseInt(maxRes, 10);
          if (w > sizeLimit || h > sizeLimit) {
            if (w > h) {
              h = Math.round((h * sizeLimit) / w);
              w = sizeLimit;
            } else {
              w = Math.round((w * sizeLimit) / h);
              h = sizeLimit;
            }
          }
        }

        for (const k in canvases) {
          const key = k as MaterialStudioMapKey;
          canvases[key].width = w;
          canvases[key].height = h;
        }

        const ctx = canvases.original.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(originalImage, 0, 0, w, h);
          loadedData = ctx.getImageData(0, 0, w, h);
        }

        triggerPBRUpdate();
      }

      const sliders = [
        { id: "height-blur", suffix: "" },
        { id: "height-contrast", suffix: "" },
        { id: "normal-strength", suffix: "%" },
        { id: "spec-contrast", suffix: "" },
        { id: "spec-thresh", suffix: "%" },
        { id: "rough-gamma", suffix: "" },
        { id: "ao-soft", suffix: "px" },
        { id: "ao-fine", suffix: "" },
        { id: "ao-level", suffix: "%" },
        { id: "edge-thresh", suffix: "%" },
        { id: "edge-thick", suffix: "" },
        { id: "metallic", suffix: "%" },
        { id: "roughness-override", suffix: "%" },
      ];

      sliders.forEach((s) => {
        const slider = document.getElementById(s.id + "-slider") as HTMLInputElement | null;
        const valDisp = document.getElementById(s.id + "-val");

        if (slider && valDisp) {
          slider.addEventListener("input", () => {
            valDisp.innerText = slider.value + s.suffix;
            triggerPBRUpdate();
          });
        }
      });

      document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", triggerPBRUpdate);
      });

      document.getElementById("normal-format")?.addEventListener("change", triggerPBRUpdate);
      document.getElementById("export-size")?.addEventListener("change", initializeImageData);

      // Profile select changes preset values
      document.getElementById("profile-select")?.addEventListener("change", (e) => {
        const profile = (e.target as HTMLSelectElement)?.value;
        if (PRESETS[profile as keyof typeof PRESETS]) {
          applyPreset(PRESETS[profile as keyof typeof PRESETS], profile);
        }
      });

      function applyPreset(preset: MaterialStudioPreset, profileName: string): void {
        const updateSliderAndVal = (
          id: string,
          val: string | number | boolean,
          postfix: string = "",
        ): void => {
          const slider = document.getElementById(id + "-slider") as HTMLInputElement | null;
          if (slider) slider.value = String(val);
          const valEl = document.getElementById(id + "-val");
          if (valEl) valEl.innerText = String(val) + postfix;
        };

        const updateCheckbox = (id: string, checked: unknown): void => {
          const cb = document.getElementById(id) as HTMLInputElement | null;
          if (cb) cb.checked = Boolean(checked);
        };

        updateSliderAndVal("height-blur", preset.heightBlur);
        updateSliderAndVal("height-contrast", preset.heightContrast);
        updateCheckbox("height-invert", preset.heightInvert);

        updateSliderAndVal("normal-strength", preset.normalStrength, "%");

        const normalFormat = document.getElementById("normal-format") as HTMLInputElement | null;
        if (normalFormat) normalFormat.value = preset.normalFormat;

        updateCheckbox("normal-invert-r", preset.normalInvertR);

        updateSliderAndVal("spec-contrast", preset.specContrast);
        updateSliderAndVal("spec-thresh", preset.specThresh, "%");
        updateCheckbox("spec-invert", preset.specInvert);

        updateSliderAndVal("rough-gamma", preset.roughGamma);
        updateCheckbox("rough-invert", preset.roughInvert);

        updateSliderAndVal("ao-soft", preset.aoSoft, "px");
        updateSliderAndVal("ao-fine", preset.aoFine);
        updateSliderAndVal("ao-level", preset.aoLevel, "%");

        updateSliderAndVal("edge-thresh", preset.edgeThresh, "%");
        updateSliderAndVal("edge-thick", preset.edgeThick);
        updateCheckbox("edge-invert", preset.edgeInvert);

        // Adjust preview material based on preset
        if (profileName === "metal") {
          updateSliderAndVal("metallic", 90, "%");
        } else {
          updateSliderAndVal("metallic", 0, "%");
        }

        triggerPBRUpdate();
      }

      // Tab switcher
      document.querySelectorAll(".swf-ms-container .tabs-bar .tool-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          document
            .querySelectorAll(".swf-ms-container .tabs-bar .tool-tab")
            .forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");

          activeTab = tab.getAttribute("data-tab") || "";

          const gridView = document.getElementById("grid-view-container");
          const singleView = document.getElementById("single-view-container");
          const preview3dContainer = document.getElementById("preview3d-container");

          if (activeTab === "grid") {
            gridView?.classList.remove("tab-content-hidden");
            singleView?.classList.add("tab-content-hidden");
            preview3dContainer?.classList.add("tab-content-hidden");
          } else if (activeTab === "preview3d") {
            gridView?.classList.add("tab-content-hidden");
            singleView?.classList.add("tab-content-hidden");
            preview3dContainer?.classList.remove("tab-content-hidden");
            // Trigger immediate push of textures to 3D view
            pushTexturesTo3D();
          } else {
            gridView?.classList.add("tab-content-hidden");
            singleView?.classList.remove("tab-content-hidden");
            preview3dContainer?.classList.add("tab-content-hidden");

            // Draw active map onto preview canvas
            const mainPreview = displays.preview as HTMLCanvasElement;
            mainPreview.width = canvases[activeTab as MaterialStudioMapKey].width;
            mainPreview.height = canvases[activeTab as MaterialStudioMapKey].height;
            const ctx = mainPreview.getContext("2d");
            if (ctx) ctx.drawImage(canvases[activeTab as MaterialStudioMapKey], 0, 0);
          }

          // Show/hide relevant settings in the sidebar
          document.querySelectorAll(".collapsible-header").forEach((header) => {
            const target = header.getAttribute("data-target") || "";
            const content = document.getElementById(target);
            if (activeTab === "grid" || activeTab === "preview3d") {
              (header as HTMLElement).style.display = "flex";
            } else {
              if (target === activeTab + "-settings") {
                (header as HTMLElement).style.display = "flex";
                header.classList.add("active");
                if (content) content.classList.add("open");
              } else {
                (header as HTMLElement).style.display = "none";
                header.classList.remove("active");
                if (content) content.classList.remove("open");
              }
            }
          });
        });
      });

      // 3D Geometry Swap buttons
      document.querySelectorAll(".geom-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".geom-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          const geom = btn.getAttribute("data-geom") || "";
          if (this._app) {
            this._app.updateGeometry(geom);
          }
        });
      });

      // Individual downloads in grid view
      document.querySelectorAll(".grid-item-download").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const mapType = btn.getAttribute("data-map") || "";
          downloadMap(mapType);
        });
      });

      // Click main canvas to download active map
      document.getElementById("canvas-main-preview")?.addEventListener("click", () => {
        if (activeTab === "grid" || activeTab === "preview3d") {
          return;
        }
        downloadMap(activeTab);
      });
      // Add cursor style to indicate it's clickable
      const mainPreviewCanvas = document.getElementById("canvas-main-preview");
      if (mainPreviewCanvas) {
        mainPreviewCanvas.style.cursor = "pointer";
        mainPreviewCanvas.title = "Click to download this map";
      }

      document.getElementById("btn-download-all")?.addEventListener("click", () => {
        const mapsToDownload = ["height", "normal", "specular", "roughness", "ao", "edge"];
        mapsToDownload.forEach((mapType) => {
          downloadMap(mapType);
        });
      });

      function downloadMap(mapType: string): void {
        const canvas = canvases[mapType as MaterialStudioMapKey];
        const link = document.createElement("a");
        link.download = `${originalFileName}_${mapType}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      }

      function triggerPBRUpdate(): void {
        needsUpdate = true;
        if (!isProcessing) {
          requestAnimationFrame(updateLoop);
        }
      }

      function updateLoop(): void {
        if (needsUpdate && loadedData) {
          needsUpdate = false;
          isProcessing = true;

          document.getElementById("loading-overlay")?.classList.add("active");
          const el = document.getElementById("loading-text");
          if (el) el.innerText = "Recalculating maps...";

          // Use timeout to let browser render loading overlay before blocking thread
          setTimeout(() => {
            generatePBRMaps();
            pushTexturesTo3D();
            isProcessing = false;
            document.getElementById("loading-overlay")?.classList.remove("active");

            if (needsUpdate) {
              triggerPBRUpdate();
            }
          }, 30);
        }
      }

      const pushTexturesTo3D = (): void => {
        if (this._app) {
          const normalStrength =
            parseFloat(
              (document.getElementById("normal-strength-slider") as HTMLInputElement).value,
            ) / 100.0;
          const metallicValue =
            parseFloat((document.getElementById("metallic-slider") as HTMLInputElement).value) /
            100.0;
          const roughnessValue =
            parseFloat(
              (document.getElementById("roughness-override-slider") as HTMLInputElement).value,
            ) / 100.0;

          this._app.updateTextures(
            canvases.original,
            canvases.normal,
            canvases.roughness,
            normalStrength,
            metallicValue,
            roughnessValue,
          );
        }
      };

      function writeToCanvas(
        canvas: HTMLCanvasElement,
        img: { width: number; height: number; data: Uint8ClampedArray },
      ): void {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const idata = ctx.createImageData(img.width, img.height);
        idata.data.set(img.data);
        ctx.putImageData(idata, 0, 0);
      }

      function generatePBRMaps(): void {
        const w = loadedData!.width;
        const h = loadedData!.height;

        const heightBlur = parseInt(
          (document.getElementById("height-blur-slider") as HTMLInputElement).value,
          10,
        );
        const heightContrast = parseFloat(
          (document.getElementById("height-contrast-slider") as HTMLInputElement).value,
        );
        const heightInvert = (document.getElementById("height-invert") as HTMLInputElement).checked;

        const normalStrength = parseFloat(
          (document.getElementById("normal-strength-slider") as HTMLInputElement).value,
        );
        const normalFormat = (document.getElementById("normal-format") as HTMLInputElement)
          .value as NormalMapFormat;
        const normalInvertR = (document.getElementById("normal-invert-r") as HTMLInputElement)
          .checked;

        const specContrast = parseInt(
          (document.getElementById("spec-contrast-slider") as HTMLInputElement).value,
          10,
        );
        const specThresh = parseInt(
          (document.getElementById("spec-thresh-slider") as HTMLInputElement).value,
          10,
        );
        const specInvert = (document.getElementById("spec-invert") as HTMLInputElement).checked;

        const roughGamma = parseFloat(
          (document.getElementById("rough-gamma-slider") as HTMLInputElement).value,
        );
        const roughInvert = (document.getElementById("rough-invert") as HTMLInputElement).checked;

        const aoSoft = parseInt(
          (document.getElementById("ao-soft-slider") as HTMLInputElement).value,
          10,
        );
        const aoFine = parseFloat(
          (document.getElementById("ao-fine-slider") as HTMLInputElement).value,
        );
        const aoLevel = parseInt(
          (document.getElementById("ao-level-slider") as HTMLInputElement).value,
          10,
        );

        const edgeThresh = parseInt(
          (document.getElementById("edge-thresh-slider") as HTMLInputElement).value,
          10,
        );
        const edgeThick = parseInt(
          (document.getElementById("edge-thick-slider") as HTMLInputElement).value,
          10,
        );
        const edgeInvert = (document.getElementById("edge-invert") as HTMLInputElement).checked;

        // 1.-6. DERIVE ALL MAPS via the headless pipeline (single source, byte-identical
        // to the former inline TextureFilters chain). The diffuse stays on the original canvas.
        const maps = derivePbrMaps(
          { width: w, height: h, data: loadedData!.data },
          {
            heightBlur,
            heightContrast,
            heightInvert,
            normalStrength,
            normalFormat,
            normalInvertR,
            specContrast,
            specThresh,
            specInvert,
            roughGamma,
            roughInvert,
            aoSoft,
            aoFine,
            aoLevel,
            edgeThresh,
            edgeThick,
            edgeInvert,
          },
        );
        writeToCanvas(canvases.height, maps.height);
        writeToCanvas(canvases.normal, maps.normal);
        writeToCanvas(canvases.specular, maps.specular);
        writeToCanvas(canvases.roughness, maps.roughness);
        writeToCanvas(canvases.ao, maps.ao);
        writeToCanvas(canvases.edge, maps.edge);

        // 7. DRAW TO VIEWPORTS
        for (const key in displays) {
          if (key === "preview") continue;

          const canvas = (displays as unknown as Record<string, HTMLCanvasElement>)[key];
          if (!canvas) continue;
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          const srcCanvas = (canvases as unknown as Record<string, HTMLCanvasElement>)[key];
          if (ctx && srcCanvas) ctx.drawImage(srcCanvas, 0, 0);
        }

        // Draw active single view if active
        if (activeTab !== "grid" && activeTab !== "preview3d") {
          const mainPreview = displays.preview as HTMLCanvasElement;
          if (mainPreview) {
            mainPreview.width = w;
            mainPreview.height = h;
            const ctx = mainPreview.getContext("2d");
            if (ctx) {
              const targetCanvas = (canvases as unknown as Record<string, HTMLCanvasElement>)[
                activeTab
              ];
              if (targetCanvas) ctx.drawImage(targetCanvas, 0, 0);
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

export { MATERIAL_STUDIO_PRESETS } from "../core/material.js";
export type { MaterialStudioMapParams } from "../core/material.js";
