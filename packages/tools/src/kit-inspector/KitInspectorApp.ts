import {
  SmallWorldMachine,
  Object3D,
  Grid,
  DirectionalLight,
  AmbientLight,
  Color,
  Vector3D,
  WireframeMaterial,
  KitRegistry,
  CameraStrategyType,
  PerspectiveProjection,
} from "@small-world-machine/engine";
import type { KitManifest } from "@small-world-machine/engine";
import {
  type IAssetSource,
  type ValidationReport,
  SecurityValidator,
  ZipAssetSink,
  downloadBlob,
  validateKitManifest,
} from "../common/io/index.js";
import type {
  KitMountResult,
  LightingPreset,
  KitInspectorOptions,
  InspectedAssetInfo,
  CameraFrame,
} from "./types.js";
import { buildPropView, buildPbrView, buildDecalView } from "./views/index.js";

export type {
  KitMountResult,
  LightingPreset,
  KitInspectorOptions,
  InspectedAssetInfo,
  CameraFrame,
};

/**
 * 3D Engine controller for the Asset Kit Inspector tool.
 * Provides interactive orbital navigation, studio lighting presets, wireframe and
 * socket inspection, as well as PBR material previewing on standard test primitives.
 */
export class KitInspectorApp extends SmallWorldMachine {
  private _kitRegistry: KitRegistry;
  private readonly _presetRegistry: KitRegistry;
  private readonly _onAssetLoaded: ((info: InspectedAssetInfo) => void) | undefined;
  private readonly _onLoadingStateChange:
    ((loading: boolean, message?: string) => void) | undefined;
  private readonly _onError: ((err: Error) => void) | undefined;

  // Custom kit import state (unified I/O — AP-3a)
  private readonly _presetBasePath: string;
  private _customSource: IAssetSource | null = null;
  private _customKitId: string | null = null;
  private _customKitName: string | null = null;
  private _customManifest: KitManifest | null = null;
  private _customPhysicalDir: string | null = null;
  private _objectUrls: string[] = [];

  // Scene roots
  private _gridMesh!: Object3D;
  private _assetRoot!: Object3D;
  private _socketsRoot!: Object3D;

  // Lighting
  private _ambientLight!: AmbientLight;
  private _keyLight!: DirectionalLight;
  private _fillLight!: DirectionalLight;
  private _rimLight!: DirectionalLight;
  private _currentLightingPreset: LightingPreset = "studio";

  // Orbit navigation state
  private _orbitTarget: Vector3D = new Vector3D(0, 0.5, 0);
  private _orbitDistance: number = 2.5;
  private _orbitYaw: number = 0.6;
  private _orbitPitch: number = 0.35;
  private _isTurntable: boolean = false;
  private _turntableSpeed: number = 0.3; // rad/s
  private _isWireframe: boolean = false;
  private _showSockets: boolean = true;
  private _showGrid: boolean = true;

  // Pointer dragging state
  private _isDragging: boolean = false;
  private _dragButton: number = 0;
  private _lastPointerX: number = 0;
  private _lastPointerY: number = 0;

  // Current loaded state
  private _currentAssetInfo: InspectedAssetInfo | null = null;
  private _originalMaterials = new Map<Object3D, unknown>();

  constructor(options: KitInspectorOptions) {
    super({
      ...options,
      fullscreen: false,
    });

    this._presetBasePath = options.basePath ?? "/assets/kits/";
    this._presetRegistry = new KitRegistry({ basePath: this._presetBasePath });
    this._kitRegistry = this._presetRegistry;
    this._onAssetLoaded = options.onAssetLoaded;
    this._onLoadingStateChange = options.onLoadingStateChange;
    this._onError = options.onError;

    this._assetRoot = new Object3D("AssetRoot");
    this._socketsRoot = new Object3D("SocketsRoot");

    this._gridMesh = new Object3D("InspectorGrid");
    this._gridMesh.geometry = new Grid({ size: 20, divisions: 20 }).getGeometryData();
    this._gridMesh.material = new WireframeMaterial(new Color(0.18, 0.24, 0.32));
    this._gridMesh.position.set(0, 0, 0);

    this._ambientLight = new AmbientLight({
      name: "InspectorAmbient",
      color: new Color(0.2, 0.22, 0.26),
      intensity: 0.6,
    });

    this._keyLight = new DirectionalLight({
      name: "InspectorKeyLight",
      color: new Color(1.0, 0.98, 0.94),
      intensity: 1.6,
      direction: new Vector3D(1.4, 2.0, 1.2).normalize(),
    });

    this._fillLight = new DirectionalLight({
      name: "InspectorFillLight",
      color: new Color(0.65, 0.8, 1.0),
      intensity: 0.65,
      direction: new Vector3D(-1.6, 1.0, -1.0).normalize(),
    });

    this._rimLight = new DirectionalLight({
      name: "InspectorRimLight",
      color: new Color(0.9, 0.85, 0.8),
      intensity: 0.8,
      direction: new Vector3D(0.2, -1.0, -2.0).normalize(),
    });
  }

  public get kitRegistry(): KitRegistry {
    return this._kitRegistry;
  }

  /** Registry for the repository preset kits — unaffected by a mounted custom kit. */
  public get presetRegistry(): KitRegistry {
    return this._presetRegistry;
  }

  /**
   * Routes a prop id to the registry that can serve it: the custom registry only when a custom
   * kit is mounted and the id belongs to it, otherwise the preset registry.
   */
  private _registryFor(kitPropId: string): KitRegistry {
    if (this._customKitId && kitPropId.startsWith(`${this._customKitId}/`)) {
      return this._kitRegistry;
    }
    return this._presetRegistry;
  }

  private _registryForKit(kitId: string): KitRegistry {
    if (this._customKitId && kitId === this._customKitId) {
      return this._kitRegistry;
    }
    return this._presetRegistry;
  }

  public get currentAssetInfo(): InspectedAssetInfo | null {
    return this._currentAssetInfo;
  }

  // --- Custom Kit Import / Export (unified tool I/O) ---

  public get hasCustomKit(): boolean {
    return this._customSource !== null;
  }

  public get customKitId(): string | null {
    return this._customKitId;
  }

  public get customKitName(): string | null {
    return this._customKitName;
  }

  public get customManifest(): KitManifest | null {
    return this._customManifest;
  }

  /**
   * Validates and mounts an external kit source (drop / folder picker / ZIP) as the active kit.
   * Strict on `kit.json` structure, tolerant on referenced files (both reported).
   */
  public async mountCustomKit(source: IAssetSource): Promise<KitMountResult> {
    const fail = (report: ValidationReport): KitMountResult => ({
      ok: false,
      report,
      kitId: "",
      name: source.name,
    });
    const { report, manifest, dir } = await validateKitManifest(source);
    if (!report.valid || !manifest) return fail(report);

    const name = typeof manifest["name"] === "string" ? manifest["name"] : source.name;
    const kitId = typeof manifest["id"] === "string" ? manifest["id"] : "custom";
    if (!kitId) return fail(report);

    const mountPrefix = `sw-asset://${source.id}/`;
    this._disposeCustom();
    this._customSource = source;
    this._customKitId = kitId;
    this._customKitName = name;
    this._customManifest = manifest as unknown as KitManifest;
    this._customPhysicalDir = dir;
    this._kitRegistry = new KitRegistry({
      basePath: mountPrefix,
      customFetch: this._buildCustomFetch(),
    });
    return { ok: true, report, kitId, name };
  }

  /** Restores the repository preset kits and releases the custom source. */
  public clearCustomKit(): void {
    if (!this.hasCustomKit) return;
    this._disposeCustom();
    this._kitRegistry = this._presetRegistry;
  }

  /**
   * Resolves asset URLs for display outside the engine (catalog thumbnails, metadata hero image):
   * virtual `sw-asset://...` URLs become object URLs from the mounted source; everything else is
   * returned unchanged.
   */
  public async resolveAssetUrl(url: string): Promise<string> {
    const source = this._customSource;
    if (!source || !url.startsWith(`sw-asset://${source.id}/`)) return url;
    const rel = this._toPhysicalPath(url);
    const data = await source.read(rel);
    const objUrl = URL.createObjectURL(new Blob([data.slice()]));
    this._objectUrls.push(objUrl);
    return objUrl;
  }

  /**
   * Round-trips the currently mounted custom kit back to a validated ZIP download.
   * Copies every file verbatim so an exported kit re-imports identically.
   * Returns `false` (no-op) when no custom kit is mounted.
   */
  public async exportActiveKit(filename?: string): Promise<boolean> {
    const source = this._customSource;
    const kitId = this._customKitId;
    if (!source || !kitId) return false;
    const sink = new ZipAssetSink({ id: `export-${kitId}` });
    for (const path of await source.list()) {
      if (!path || path.endsWith("/")) continue;
      sink.write(path, await source.read(path));
    }
    const blob = await sink.finalize();
    downloadBlob(blob, filename ?? `${kitId}.zip`);
    sink.dispose();
    return true;
  }

  private _buildCustomFetch(): (url: string, init?: RequestInit) => Promise<Response> {
    const source = this._customSource;
    const prefix = source ? `sw-asset://${source.id}/` : "";
    return async (url: string, init?: RequestInit): Promise<Response> => {
      if (!source || !url.startsWith(prefix)) return fetch(url, init);
      const rel = this._toPhysicalPath(url);
      const data = await source.read(rel);
      return new Response(data.slice(), {
        status: 200,
        statusText: "OK",
        headers: {
          "Content-Type": SecurityValidator.getMimeType(rel),
          "Content-Length": String(data.byteLength),
        },
      });
    };
  }

  /** Maps a virtual `sw-asset://<id>/<kitId>/…` URL to the physical path inside the source. */
  private _toPhysicalPath(url: string): string {
    const prefix = this._customSource ? `sw-asset://${this._customSource.id}/` : "";
    let rel = url.startsWith(prefix) ? url.substring(prefix.length) : url;
    if (this._customKitId && rel.startsWith(`${this._customKitId}/`)) {
      rel = rel.substring(this._customKitId.length + 1);
    }
    rel = rel.replace(/^\/+/, "");
    return this._customPhysicalDir ? `${this._customPhysicalDir}/${rel}` : rel;
  }

  private _disposeCustom(): void {
    for (const objUrl of this._objectUrls) {
      URL.revokeObjectURL(objUrl);
    }
    this._objectUrls = [];
    this._customSource?.dispose?.();
    this._customSource = null;
    this._customKitId = null;
    this._customKitName = null;
    this._customManifest = null;
    this._customPhysicalDir = null;
  }

  protected override async setupScene(): Promise<void> {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    this.camera.projection = new PerspectiveProjection({
      fov: (45 * Math.PI) / 180,
      aspect,
      near: 0.05,
      far: 150,
    });
    this.camera.updateProjectionMatrix();
    this.camera.setStrategy(CameraStrategyType.MANUAL);

    // Add lighting & containers to scene
    this.scene.add(this._ambientLight);
    this.scene.add(this._keyLight);
    this.scene.add(this._fillLight);
    this.scene.add(this._rimLight);
    this.scene.add(this._gridMesh);
    this.scene.add(this._assetRoot);
    this.scene.add(this._socketsRoot);

    // Setup Camera and Pointer
    this._updateCameraTransform();
    this._setupPointerNavigation();
  }

  protected override update(deltaTime: number): void {
    if (this._isTurntable && !this._isDragging) {
      this._orbitYaw += this._turntableSpeed * deltaTime;
      this._updateCameraTransform();
    }
  }

  // --- Public View Controls ---

  public setLightingPreset(preset: LightingPreset): void {
    this._currentLightingPreset = preset;
    if (preset === "studio") {
      this._ambientLight.color.set(0.2, 0.22, 0.26);
      this._ambientLight.intensity = 0.6;
      this._keyLight.color.set(1.0, 0.98, 0.94);
      this._keyLight.intensity = 1.6;
      this._keyLight.direction.set(1.4, 2.0, 1.2).normalize();
      this._fillLight.color.set(0.65, 0.8, 1.0);
      this._fillLight.intensity = 0.65;
      this._rimLight.color.set(0.9, 0.85, 0.8);
      this._rimLight.intensity = 0.8;
    } else if (preset === "bunker") {
      this._ambientLight.color.set(0.08, 0.08, 0.1);
      this._ambientLight.intensity = 0.35;
      this._keyLight.color.set(1.0, 0.68, 0.28); // Warm Kerosene amber
      this._keyLight.intensity = 2.4;
      this._keyLight.direction.set(1.2, 1.6, 1.0).normalize();
      this._fillLight.color.set(0.22, 0.32, 0.45); // Deep shadow cold
      this._fillLight.intensity = 0.45;
      this._rimLight.color.set(0.95, 0.5, 0.15);
      this._rimLight.intensity = 1.2;
    } else if (preset === "cold") {
      this._ambientLight.color.set(0.12, 0.16, 0.22);
      this._ambientLight.intensity = 0.4;
      this._keyLight.color.set(0.72, 0.88, 1.0); // Industrial fluorescent
      this._keyLight.intensity = 2.0;
      this._keyLight.direction.set(0.6, 2.2, 0.8).normalize();
      this._fillLight.color.set(0.2, 0.6, 0.85); // Frost cyan
      this._fillLight.intensity = 0.8;
      this._rimLight.color.set(0.4, 0.75, 1.0);
      this._rimLight.intensity = 1.0;
    }
  }

  public getLightingPreset(): LightingPreset {
    return this._currentLightingPreset;
  }

  public setTurntable(enabled: boolean): void {
    this._isTurntable = enabled;
  }

  public isTurntable(): boolean {
    return this._isTurntable;
  }

  public setWireframe(enabled: boolean): void {
    this._isWireframe = enabled;
    const wireMat = new WireframeMaterial(new Color(0.0, 0.9, 1.0));

    this._assetRoot.traverse((child) => {
      if (!child.geometry) return;
      if (enabled) {
        if (!this._originalMaterials.has(child)) {
          this._originalMaterials.set(child, child.material);
        }
        child.material = wireMat;
      } else {
        const orig = this._originalMaterials.get(child);
        if (orig) {
          child.material = orig as typeof child.material;
        }
      }
    });
  }

  public isWireframe(): boolean {
    return this._isWireframe;
  }

  public setSocketsVisible(visible: boolean): void {
    this._showSockets = visible;
    this._socketsRoot.isVisible = visible;
  }

  public areSocketsVisible(): boolean {
    return this._showSockets;
  }

  public setGridVisible(visible: boolean): void {
    this._showGrid = visible;
    this._gridMesh.isVisible = visible;
  }

  public isGridVisible(): boolean {
    return this._showGrid;
  }

  public focusCamera(): void {
    this._orbitTarget.set(0, 0.5, 0);
    this._orbitDistance = 2.5;
    this._orbitYaw = 0.6;
    this._orbitPitch = 0.35;
    this._updateCameraTransform();
  }

  // --- Asset Loading ---

  private _applyCameraFrame(frame: CameraFrame): void {
    this._orbitTarget.set(frame.target.x, frame.target.y, frame.target.z);
    this._orbitDistance = frame.distance;
    if (frame.yaw !== undefined) this._orbitYaw = frame.yaw;
    if (frame.pitch !== undefined) this._orbitPitch = frame.pitch;
    this._updateCameraTransform();
  }

  /**
   * Loads and displays a 3D kit prop by its ID (e.g. "bunker/kerosene_lantern").
   */
  public async inspectProp(kitPropId: string): Promise<void> {
    this._onLoadingStateChange?.(true, `Lade 3D-Prop ${kitPropId}...`);
    this._clearAsset();

    try {
      const reg = this._registryFor(kitPropId);
      const result = await buildPropView(reg, kitPropId);

      this._assetRoot.add(result.root);
      this._socketsRoot.add(result.socketsRoot);
      this._applyCameraFrame(result.cameraFrame);

      if (this._isWireframe) {
        this.setWireframe(true);
      }

      this._currentAssetInfo = result.info;
      this._onAssetLoaded?.(result.info);
      this._onLoadingStateChange?.(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._onError?.(error);
      this._onLoadingStateChange?.(false);
    }
  }

  /**
   * Displays a PBR texture set on a preview sphere.
   */
  public async inspectPbrTexture(
    kitId: string,
    texItem: { id: string; name: string; category?: string; maps: string[] },
  ): Promise<void> {
    this._onLoadingStateChange?.(true, `Lade PBR Material ${texItem.name}...`);
    this._clearAsset();

    try {
      const reg = this._registryForKit(kitId);
      const result = await buildPbrView(reg, kitId, texItem);

      this._assetRoot.add(result.root);
      this._applyCameraFrame(result.cameraFrame);

      this._currentAssetInfo = result.info;
      this._onAssetLoaded?.(result.info);
      this._onLoadingStateChange?.(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._onError?.(error);
      this._onLoadingStateChange?.(false);
    }
  }

  /**
   * Displays a decal sticker on a floating quad.
   */
  public async inspectDecal(
    kitId: string,
    decalItem: { id: string; name: string; file: string },
  ): Promise<void> {
    this._onLoadingStateChange?.(true, `Lade Decal ${decalItem.name}...`);
    this._clearAsset();

    try {
      const reg = this._registryForKit(kitId);
      const result = await buildDecalView(reg, kitId, decalItem);

      this._assetRoot.add(result.root);
      this._applyCameraFrame(result.cameraFrame);

      this._currentAssetInfo = result.info;
      this._onAssetLoaded?.(result.info);
      this._onLoadingStateChange?.(false);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._onError?.(error);
      this._onLoadingStateChange?.(false);
    }
  }

  // --- Internal Helpers ---

  private _clearAsset(): void {
    this._originalMaterials.clear();

    while (this._assetRoot.children.length > 0) {
      const child = this._assetRoot.children[0];
      if (child) this._assetRoot.remove(child);
    }

    while (this._socketsRoot.children.length > 0) {
      const child = this._socketsRoot.children[0];
      if (child) this._socketsRoot.remove(child);
    }
  }

  private _updateCameraTransform(): void {
    const cosPitch = Math.cos(this._orbitPitch);
    this.camera.position.x =
      this._orbitTarget.x + this._orbitDistance * cosPitch * Math.sin(this._orbitYaw);
    this.camera.position.y = this._orbitTarget.y + this._orbitDistance * Math.sin(this._orbitPitch);
    this.camera.position.z =
      this._orbitTarget.z + this._orbitDistance * cosPitch * Math.cos(this._orbitYaw);
    this.camera.target.copyFrom(this._orbitTarget);
    this.camera.updateViewMatrix();
  }

  private _setupPointerNavigation(): void {
    const canvas = this.canvas;

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      this._isDragging = true;
      this._dragButton = e.button;
      this._lastPointerX = e.clientX;
      this._lastPointerY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", (e: PointerEvent) => {
      if (!this._isDragging) return;

      const dx = e.clientX - this._lastPointerX;
      const dy = e.clientY - this._lastPointerY;
      this._lastPointerX = e.clientX;
      this._lastPointerY = e.clientY;

      if (this._dragButton === 0 && !e.shiftKey) {
        // Left drag: Rotate
        this._orbitYaw -= dx * 0.007;
        this._orbitPitch = Math.min(1.48, Math.max(-1.48, this._orbitPitch - dy * 0.007));
      } else {
        // Right drag or Shift+Left drag: Pan
        const panFactor = this._orbitDistance * 0.0015;
        const cosYaw = Math.cos(this._orbitYaw);
        const sinYaw = Math.sin(this._orbitYaw);

        this._orbitTarget.x -= (dx * cosYaw + dy * sinYaw) * panFactor;
        this._orbitTarget.y += dy * panFactor;
        this._orbitTarget.z -= (-dx * sinYaw + dy * cosYaw) * panFactor;
      }

      this._updateCameraTransform();
    });

    const endDrag = (e: PointerEvent): void => {
      this._isDragging = false;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };

    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    canvas.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const factor = Math.exp(e.deltaY * 0.0015);
        this._orbitDistance = Math.min(40.0, Math.max(0.3, this._orbitDistance * factor));
        this._updateCameraTransform();
      },
      { passive: false },
    );

    // Keyboard shortcuts
    window.addEventListener("keydown", (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "f" || e.key === "F") {
        this.focusCamera();
      } else if (e.key === "r" || e.key === "R") {
        this.setTurntable(!this._isTurntable);
      } else if (e.key === "w" || e.key === "W") {
        this.setWireframe(!this._isWireframe);
      } else if (e.key === "s" || e.key === "S") {
        this.setSocketsVisible(!this._showSockets);
      } else if (e.key === "g" || e.key === "G") {
        this.setGridVisible(!this._showGrid);
      }
    });

    window.addEventListener("resize", () => {
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      if (this.camera.projection instanceof PerspectiveProjection) {
        this.camera.projection.aspect = aspect;
        this.camera.updateProjectionMatrix();
      }
      this._updateCameraTransform();
    });
  }
}
