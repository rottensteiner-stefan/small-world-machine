import type { ForgeToolOptions } from "@small-world-machine/engine";
import { ForgeTool } from "@small-world-machine/engine";
import { IBLBaker } from "./ibl-gen.js";
import { UniversalIngestDropzone } from "../common/io/ui/UniversalIngestDropzone.js";
import type { IngestResult } from "../common/io/UniversalIngestTypes.js";
import { ZipAssetSink } from "../common/io/sinks/ZipAssetSink.js";
import { downloadBlob } from "../common/io/sinks/DownloadAssetSink.js";
import { firstImageItem, primaryPbrTexture } from "../common/io/ingestResultHelpers.js";

const STYLE_ID = "ibl-gen-tool-style";

const CSS = `
.iblgen { display: flex; height: 100%; overflow: hidden; font-family: var(--tool-font-ui); color: var(--tool-text); }
.iblgen-panel { display: flex; flex-direction: column; gap: 1.5rem; width: 300px; padding: 1.5rem; background: var(--tool-panel); border-right: 1px solid var(--tool-border); }
.iblgen-group { display: flex; flex-direction: column; gap: 0.5rem; }
.iblgen-group label { font-weight: 600; font-size: 0.9rem; text-transform: uppercase; color: var(--tool-text-muted); }
.iblgen-group small { color: var(--tool-text-muted); }
.iblgen-group .swf-btn:disabled { background: var(--tool-card); color: var(--tool-text-muted); border-color: transparent; box-shadow: none; cursor: not-allowed; pointer-events: none; }
.iblgen-progress { font-size: 0.9rem; color: var(--tool-accent); min-height: 1.2em; }
.iblgen-preview { flex: 1; display: flex; flex-direction: column; gap: 1rem; padding: 2rem; overflow-y: auto; }
.iblgen-preview h2 { margin: 0; }
.iblgen-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(256px, 1fr)); gap: 1rem; }
.iblgen-card { padding: 1rem; text-align: center; background: var(--tool-inset); border: 1px solid var(--tool-border); border-radius: var(--tool-radius-lg); }
.iblgen-card h3 { margin: 0 0 0.5rem; font-size: 1rem; color: var(--tool-accent); }
.iblgen-card canvas { width: 100%; max-height: 250px; object-fit: contain; image-rendering: pixelated; background: var(--tool-on-accent); border-radius: var(--tool-radius-md); }
`;

const HTML = `
<div class="iblgen">
  <div class="iblgen-panel">
    <div class="iblgen-group">
      <label>1. Select HDR/Panorama (Equirectangular)</label>
      <div data-ibl="dropzone"></div>
      <small>Must be a 2:1 aspect ratio image (e.g. 2048x1024).</small>
    </div>
    <div class="iblgen-group">
      <label>2. Generate Maps</label>
      <button class="swf-btn" data-ibl="generate" disabled>Bake IBL</button>
      <div class="iblgen-progress" data-ibl="progress"></div>
    </div>
    <div class="iblgen-group">
      <label>3. Export</label>
      <button class="swf-btn" data-ibl="export" disabled>Download Maps (.zip)</button>
    </div>
  </div>
  <div class="iblgen-preview">
    <h2>Generated Textures</h2>
    <div class="iblgen-cards">
      <div class="iblgen-card"><h3>Environment (Base)</h3><canvas id="ibl-env-canvas" width="256" height="256"></canvas><small>Face: +Z</small></div>
      <div class="iblgen-card"><h3>Irradiance (Diffuse)</h3><canvas id="ibl-irradiance-canvas" width="256" height="256"></canvas><small>Face: +Z</small></div>
      <div class="iblgen-card"><h3>Prefiltered (Roughness = 0.5)</h3><canvas id="ibl-prefilter-canvas" width="256" height="256"></canvas><small>Face: +Z (MipLevel 2)</small></div>
      <div class="iblgen-card"><h3>BRDF LUT</h3><canvas id="ibl-brdf-canvas" width="256" height="256"></canvas></div>
    </div>
  </div>
</div>
`;

interface BakedCubemaps {
  env: WebGLTexture;
  irradiance: WebGLTexture;
  prefiltered: WebGLTexture;
}

/**
 * IBL Generator as a `ForgeTool` (Maker shell mode `#ibl`): drop an equirectangular panorama, bake
 * environment / irradiance / GGX-prefilter cubemaps and the BRDF LUT, export them as a zip.
 *
 * The `IBLBaker` owns a hidden WebGL2 context, so it is created on the first bake rather than on
 * mount and released in `unmount()` (ADR 0033: at most two live 3D surfaces). The standalone page
 * `public/tools/ibl-gen.html` keeps its own inline glue.
 */
export class IblGenTool extends ForgeTool {
  private _baker: IBLBaker | undefined;
  private _dropzone: UniversalIngestDropzone | undefined;
  private _panorama: Blob | undefined;
  private _baked: BakedCubemaps | undefined;
  private _disposed = false;

  constructor(options: ForgeToolOptions = {}) {
    super(options);
    this._injectCss();
    this._container.innerHTML = HTML;
    this._dropzone = new UniversalIngestDropzone({
      container: this._part("dropzone"),
      label: "HDR ablegen",
      supportedKinds: ["image", "pbr-set", "zip", "files", "svg", "text"],
      enableWindowDrop: true,
      enablePaste: true,
      onIngest: async (result: IngestResult): Promise<void> => this._onIngest(result),
      onError: (error: Error): void => console.error("IBL Ingest Error:", error),
    });
    this._part("generate").addEventListener("click", () => void this._bake());
    this._part("export").addEventListener("click", () => void this._export());
  }

  public getState(): unknown {
    return {};
  }

  public setState(_state: unknown): void {}

  public override unmount(): void {
    this._disposed = true;
    this._dropzone?.dispose();
    this._dropzone = undefined;
    this._baker?.dispose();
    this._baker = undefined;
    this._baked = undefined;
    super.unmount();
  }

  private _injectCss(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  private _part(name: string): HTMLElement {
    const el = this._container.querySelector<HTMLElement>(`[data-ibl="${name}"]`);
    if (!el) throw new Error(`IblGenTool: missing part "${name}"`);
    return el;
  }

  private _setProgress(text: string): void {
    this._part("progress").textContent = text;
  }

  private _onIngest(result: IngestResult): void {
    let blob: Blob | undefined;
    if (result.kind === "image" || result.kind === "svg") {
      blob = result.blob;
    } else if (result.kind === "pbr-set") {
      blob = primaryPbrTexture(result.pbrSet);
    } else if (result.kind === "archive" || result.kind === "files") {
      blob = firstImageItem(result)?.blob;
    }
    if (!blob) return;
    this._panorama = blob;
    (this._part("generate") as HTMLButtonElement).disabled = false;
  }

  private async _bake(): Promise<void> {
    const panorama = this._panorama;
    if (!panorama) return;
    const generate = this._part("generate") as HTMLButtonElement;
    const exportBtn = this._part("export") as HTMLButtonElement;
    generate.disabled = true;
    exportBtn.disabled = true;
    try {
      this._baker ??= new IBLBaker();
      const baker = this._baker;
      this._setProgress("Generating BRDF LUT...");
      await baker.generateBRDF("ibl-brdf-canvas");
      this._setProgress("BRDF LUT generated, loading panorama...");
      const equirect = await baker.loadEquirectangularImage(panorama);
      this._setProgress("Generating environment cubemap...");
      const env = await baker.generateEnvironmentCubemap(equirect, "ibl-env-canvas");
      this._setProgress("Generating irradiance convolution...");
      const irradiance = await baker.generateIrradianceCubemap(env, "ibl-irradiance-canvas");
      this._setProgress("Generating GGX prefilter...");
      const prefiltered = await baker.generatePrefilteredCubemap(env, "ibl-prefilter-canvas");
      if (this._disposed) return;
      this._baked = { env, irradiance, prefiltered };
      this._setProgress("All maps generated. Ready for export.");
      exportBtn.disabled = false;
    } catch (error) {
      console.error(error);
      if (!this._disposed) this._setProgress(`Error: ${(error as Error).message}`);
    } finally {
      if (!this._disposed) generate.disabled = false;
    }
  }

  private async _export(): Promise<void> {
    const baker = this._baker;
    const baked = this._baked;
    if (!baker || !baked) return;
    const exportBtn = this._part("export") as HTMLButtonElement;
    exportBtn.disabled = true;
    this._setProgress("Zipping...");
    try {
      const sink = new ZipAssetSink();
      const bytes = async (blob: Promise<Blob>): Promise<Uint8Array> =>
        new Uint8Array(await (await blob).arrayBuffer());
      await sink.write("env.webp", await bytes(baker.exportCubemapToCross(baked.env, 512, 0)));
      await sink.write(
        "irradiance.webp",
        await bytes(baker.exportCubemapToCross(baked.irradiance, 32, 0)),
      );
      let size = 128;
      for (let mip = 0; mip < 5; mip++) {
        await sink.write(
          `prefilter/mip${mip}.png`,
          await bytes(baker.exportCubemapToCross(baked.prefiltered, size, mip)),
        );
        size = Math.floor(size / 2);
      }
      await sink.write("brdf_lut.webp", await bytes(baker.exportBRDFToBlob("ibl-brdf-canvas")));
      downloadBlob(await sink.finalize(), "ibl_maps.zip");
      sink.dispose();
      this._setProgress("Export complete.");
    } catch (error) {
      console.error(error);
      this._setProgress(`Export failed: ${(error as Error).message}`);
    } finally {
      if (!this._disposed) exportBtn.disabled = false;
    }
  }
}
