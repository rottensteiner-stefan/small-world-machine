import type { ForgeToolOptions } from "@small-world-machine/engine";
import { ForgeTool } from "@small-world-machine/engine";
import { FileAssetSource } from "../common/io/sources/FileAssetSource.js";
import { validateKitManifest } from "../common/io/KitManifestValidator.js";
import { UniversalIngestDropzone } from "../common/io/ui/UniversalIngestDropzone.js";
import type { IngestResult } from "../common/io/UniversalIngestTypes.js";
import type { IAssetSource, ValidationIssue, ValidationSeverity } from "../common/io/types.js";

const STYLE_ID = "kit-validator-tool-style";

const CSS = `
.kitval { display: flex; height: 100%; overflow: hidden; font-family: var(--tool-font-ui); color: var(--tool-text); }
.kitval-panel { display: flex; flex-direction: column; gap: 1rem; width: 300px; padding: 1.5rem; background: var(--tool-panel); border-right: 1px solid var(--tool-border); }
.kitval-panel label { font-weight: 600; font-size: 0.9rem; text-transform: uppercase; color: var(--tool-text-muted); }
.kitval-panel small { color: var(--tool-text-muted); }
.kitval-result { flex: 1; display: flex; flex-direction: column; gap: 1rem; padding: 2rem; overflow-y: auto; }
.kitval-result h2 { margin: 0; }
.kitval-empty { color: var(--tool-text-muted); }
.kitval-verdict { display: inline-block; padding: 0.15rem 0.6rem; border-radius: var(--tool-radius-md); font-weight: 600; color: var(--tool-on-accent); }
.kitval-verdict[data-valid="true"] { background: var(--tool-success); }
.kitval-verdict[data-valid="false"] { background: var(--tool-danger); }
.kitval-meta, .kitval-counts { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; color: var(--tool-text-muted); }
.kitval-counts [data-severity="error"] { color: var(--tool-danger); }
.kitval-counts [data-severity="warning"] { color: var(--tool-warning); }
.kitval-counts [data-severity="info"] { color: var(--tool-info); }
.kitval-issues { margin: 0; padding: 0; list-style: none; background: var(--tool-inset); border: 1px solid var(--tool-border); border-radius: var(--tool-radius-lg); }
.kitval-issues li { padding: 0.5rem 1rem; border-bottom: 1px solid var(--tool-border); }
.kitval-issues li:last-child { border-bottom: 0; }
.kitval-sev { font-weight: 600; margin-right: 0.5rem; }
.kitval-issues li[data-severity="error"] .kitval-sev { color: var(--tool-danger); }
.kitval-issues li[data-severity="warning"] .kitval-sev { color: var(--tool-warning); }
.kitval-issues li[data-severity="info"] .kitval-sev { color: var(--tool-info); }
.kitval-path { display: block; font-family: var(--tool-font-mono); font-size: 0.8rem; color: var(--tool-text-muted); }
`;

const HTML = `
<div class="kitval">
  <div class="kitval-panel">
    <label>Kit prüfen</label>
    <div data-kitval="dropzone"></div>
    <small>Kit-Ordner oder ZIP mit <code>kit.json</code> ablegen. Geprüft werden Manifest-Struktur und die referenzierten Dateien, nichts wird geladen oder verändert.</small>
  </div>
  <div class="kitval-result" data-kitval="result" aria-live="polite">
    <h2>Befund</h2>
    <div class="kitval-empty">Noch kein Kit geprüft.</div>
  </div>
</div>
`;

/** Display order of severities: blocking findings first. */
const SEVERITIES: readonly ValidationSeverity[] = ["error", "warning", "info"];

/** Builds a validatable source from a dropped folder, ZIP or file list, or undefined for other kinds. */
function sourceFromIngest(result: IngestResult): IAssetSource | undefined {
  if (result.kind === "gltf") return result.source;
  if (result.kind === "archive") {
    return new FileAssetSource(
      result.files.map((item) => ({
        path: item.path,
        file: new File([item.blob], item.name, { type: item.mimeType }),
      })),
      { name: result.name },
    );
  }
  if (result.kind === "files") {
    return new FileAssetSource(
      result.files.map((file) => ({ path: file.webkitRelativePath || file.name, file })),
      { name: result.name },
    );
  }
  return undefined;
}

function countOf(manifest: Record<string, unknown> | null, key: string): number {
  const value = manifest?.[key];
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Kit validator as a `ForgeTool` (Maker shell mode `#kit`): drop a kit folder or ZIP and read the
 * `KitManifestValidator` report inline. Pure `common/io`, no 3D surface (ADR 0033); the 3D viewer
 * stays in the standalone Kit Inspector. The same report is available headless as `swm kit validate`.
 */
export class KitValidatorTool extends ForgeTool {
  private _dropzone: UniversalIngestDropzone | undefined;
  private _disposed = false;

  constructor(options: ForgeToolOptions = {}) {
    super(options);
    this._injectCss();
    this._container.innerHTML = HTML;
    this._dropzone = new UniversalIngestDropzone({
      container: this._part("dropzone"),
      label: "Kit ablegen",
      supportedKinds: ["archive", "gltf", "files"],
      enableWindowDrop: true,
      enablePaste: true,
      onIngest: async (result: IngestResult): Promise<void> => this._onIngest(result),
      onError: (error: Error): void => this._showError(error.message),
    });
  }

  public getState(): unknown {
    return {};
  }

  public setState(_state: unknown): void {}

  public override unmount(): void {
    this._disposed = true;
    this._dropzone?.dispose();
    this._dropzone = undefined;
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
    const el = this._container.querySelector<HTMLElement>(`[data-kitval="${name}"]`);
    if (!el) throw new Error(`KitValidatorTool: missing part "${name}"`);
    return el;
  }

  private async _onIngest(result: IngestResult): Promise<void> {
    const source = sourceFromIngest(result);
    if (!source) return;
    try {
      const { report, manifest } = await validateKitManifest(source);
      if (this._disposed) return;
      this._render(source.name, report.valid, report.issues, manifest);
    } catch (error) {
      console.error(error);
      this._showError((error as Error).message);
    } finally {
      source.dispose?.();
    }
  }

  private _showError(message: string): void {
    if (this._disposed) return;
    const result = this._part("result");
    result.replaceChildren(this._el("h2", "Befund"), this._el("div", `Fehler: ${message}`));
  }

  private _render(
    sourceName: string,
    valid: boolean,
    issues: readonly ValidationIssue[],
    manifest: Record<string, unknown> | null,
  ): void {
    const result = this._part("result");

    const heading = this._el("h2", String(manifest?.["name"] ?? sourceName));
    const verdict = this._el("span", valid ? "gültig" : "nicht gültig", "kitval-verdict");
    verdict.dataset["valid"] = String(valid);
    heading.append(" ", verdict);

    const meta = this._el("div", "", "kitval-meta");
    for (const key of ["id", "version"]) {
      const value = manifest?.[key];
      if (typeof value === "string") meta.append(this._el("span", `${key}: ${value}`));
    }
    for (const key of ["items", "textures", "decals"]) {
      meta.append(this._el("span", `${key}: ${countOf(manifest, key)}`));
    }

    const counts = this._el("div", "", "kitval-counts");
    for (const severity of SEVERITIES) {
      const count = issues.filter((issue) => issue.severity === severity).length;
      const label = this._el("span", `${count} ${severity}`);
      label.dataset["severity"] = severity;
      counts.append(label);
    }

    const children: HTMLElement[] = [heading, meta, counts];
    if (issues.length === 0) {
      children.push(this._el("div", "Keine Befunde.", "kitval-empty"));
    } else {
      const list = this._el("ul", "", "kitval-issues");
      const ordered = [...issues].sort(
        (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity),
      );
      for (const issue of ordered) {
        const item = this._el("li", "");
        item.dataset["severity"] = issue.severity;
        item.append(this._el("span", issue.severity.toUpperCase(), "kitval-sev"), issue.message);
        if (issue.path) item.append(this._el("span", issue.path, "kitval-path"));
        list.append(item);
      }
      children.push(list);
    }
    result.replaceChildren(...children);
  }

  private _el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text: string,
    className?: string,
  ): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
}
