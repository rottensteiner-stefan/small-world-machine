import { Object3D } from "../../core/Object3D.js";
import { AbstractLight } from "../../core/lights/AbstractLight.js";
import { PointLight } from "../../core/lights/PointLight.js";
import { SpotLight } from "../../core/lights/SpotLight.js";
import { DirectionalLight } from "../../core/lights/DirectionalLight.js";
import { AmbientLight } from "../../core/lights/AmbientLight.js";
import { Color } from "../../core/colors/Color.js";
import { Decal } from "../../core/objects/Decal.js";
import { createDecalShell } from "./DecalShell.js";
import { DecalMaterial } from "../../core/materials/surface/DecalMaterial.js";
import { Texture } from "../../core/textures/index.js";
import { StandardMaterial } from "../../core/materials/surface/StandardMaterial.js";
import { Vector3D } from "../../math/Vector3D.js";
import { AssetManager } from "../AssetManager.js";
import { GltfLoader } from "../GltfLoader.js";
import {
  assertKitManifest,
  assertPropMeta,
  type KitManifest,
  type KitManifestItem,
  type KitDecalItem,
  type LevelDecalPlacement,
  type PropMeta,
  type LoadPropOptions,
  type KitPropInstance,
  type LevelDescriptor,
  type LevelInstance,
} from "./KitTypes.js";

export * from "./KitTypes.js";

export interface KitRegistryOptions {
  /** Base path prepended to kit queries. Defaults to "/assets/kits/". */
  basePath?: string;
  /** Injected AssetManager instance for network loading and caching. */
  assetManager?: AssetManager;
  /** Injected GltfLoader instance. */
  gltfLoader?: GltfLoader;
  /** Injected custom fetch function (e.g. for virtual tool I/O schemes like sw-asset:// or ZIP sources). */
  customFetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Manages modular asset kits, manifest resolution, meta.json parsing, socket light mounting,
 * and declarative level loading according to ADR 0011 and ADR 0020.
 *
 * Designed for pure Constructor Injection / Dependency Injection — strictly no global singletons.
 */
export class KitRegistry {
  private _basePath: string;
  private _assetManager: AssetManager;
  private _gltfLoader: GltfLoader;

  private _manifestCache = new Map<string, Promise<KitManifest>>();
  private _metaCache = new Map<string, Promise<PropMeta>>();

  constructor(options: KitRegistryOptions = {}) {
    this._basePath = options.basePath ?? "/assets/kits/";
    if (!this._basePath.endsWith("/")) {
      this._basePath += "/";
    }
    this._assetManager = options.assetManager ?? new AssetManager();
    if (options.customFetch) {
      this._assetManager.customFetch = options.customFetch;
    }
    this._gltfLoader = options.gltfLoader ?? new GltfLoader({ assetManager: this._assetManager });
  }

  public get basePath(): string {
    return this._basePath;
  }

  public get assetManager(): AssetManager {
    return this._assetManager;
  }

  public get gltfLoader(): GltfLoader {
    return this._gltfLoader;
  }

  /**
   * Fetches and caches the `kit.json` manifest for a given kit ID (e.g. "bunker", "flakturm").
   */
  public async getKitManifest(kitId: string): Promise<KitManifest> {
    const cached = this._manifestCache.get(kitId);
    if (cached) return cached;

    const manifestUrl = `${this._basePath}${kitId}/kit.json`;
    const promise = (async (): Promise<KitManifest> => {
      try {
        const json = await this._assetManager.loadJson(manifestUrl);
        assertKitManifest(json, `KitRegistry:${kitId}`);
        return json;
      } catch (err) {
        this._manifestCache.delete(kitId);
        throw err;
      }
    })();

    this._manifestCache.set(kitId, promise);
    return promise;
  }

  /**
   * Resolves the `meta.json` spec sheet for a kit prop ID (e.g. "bunker/kerosene_lantern").
   */
  public async getPropMeta(kitPropId: string): Promise<PropMeta> {
    const cached = this._metaCache.get(kitPropId);
    if (cached) return cached;

    const parts = kitPropId.split("/");
    const kitId = parts[0] ?? "";
    const manifest = await this.getKitManifest(kitId);

    const items = manifest.items ?? [];
    const item = items.find(
      (it: KitManifestItem) => it.id === kitPropId || it.id.endsWith(kitPropId),
    );
    if (!item) {
      throw new Error(
        `[KitRegistry] Item '${kitPropId}' not found in kit manifest '${kitId}/kit.json'.`,
      );
    }

    const metaUrl = `${this._basePath}${kitId}/${item.meta}`;
    const promise = (async (): Promise<PropMeta> => {
      try {
        const json = await this._assetManager.loadJson(metaUrl);
        assertPropMeta(json, `KitRegistry:${kitPropId}`);
        return json;
      } catch (err) {
        this._metaCache.delete(kitPropId);
        throw err;
      }
    })();

    this._metaCache.set(kitPropId, promise);
    return promise;
  }

  /**
   * Loads a kit prop glTF, reads its `meta.json`, applies `recommendedScale` (unless overridden),
   * mounts socket lights, and applies level-instance transform/material overrides.
   */
  public async loadProp(
    kitPropId: string,
    options: LoadPropOptions = {},
  ): Promise<KitPropInstance> {
    const parts = kitPropId.split("/");
    const kitId = parts[0] ?? "";
    const manifest = await this.getKitManifest(kitId);

    const propItems = manifest.items ?? [];
    const item = propItems.find(
      (it: KitManifestItem) => it.id === kitPropId || it.id.endsWith(kitPropId),
    );
    if (!item) {
      throw new Error(
        `[KitRegistry] Prop '${kitPropId}' not found in manifest for kit '${kitId}'.`,
      );
    }

    const [meta, gltfRoot] = await Promise.all([
      this.getPropMeta(kitPropId),
      this._gltfLoader.load(`${this._basePath}${kitId}/${item.path}`),
    ]);

    const root = gltfRoot;
    root.name = item.name;

    // 1. Scale Resolution (Options override -> meta.recommendedScale default -> 1.0)
    if (options.scale !== undefined) {
      if (typeof options.scale === "number") {
        root.scale.set(options.scale, options.scale, options.scale);
      } else {
        root.scale.set(options.scale[0], options.scale[1], options.scale[2]);
      }
    } else if (options.applyRecommendedScale !== false && meta.recommendedScale !== undefined) {
      root.scale.set(meta.recommendedScale, meta.recommendedScale, meta.recommendedScale);
    }

    // 2. Position & Rotation placement
    if (options.position) {
      root.position.set(options.position[0], options.position[1], options.position[2]);
    }
    if (options.rotation) {
      root.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
    }

    // 3. Material Overrides
    if (options.materialOverrides) {
      const matOv = options.materialOverrides;
      root.traverse((child) => {
        if (child.material instanceof StandardMaterial) {
          if (matOv.roughness !== undefined) child.material.roughness = matOv.roughness;
          if (matOv.metallic !== undefined) child.material.metallic = matOv.metallic;
          if (matOv.emissiveIntensity !== undefined) {
            child.material.emissiveIntensity = matOv.emissiveIntensity;
          }
          if (matOv.emissiveColor !== undefined) {
            child.material.emissiveColor = Color.fromHex(matOv.emissiveColor);
          }
        }
      });
    }

    // 4. Socket Sockets & Automatic Light Mounting
    const lights = new Map<string, AbstractLight>();

    if (meta.sockets && Array.isArray(meta.sockets)) {
      for (const socket of meta.sockets) {
        const socketAnchor = new Object3D(`Socket_${socket.name}`);
        socketAnchor.position.set(socket.position[0], socket.position[1], socket.position[2]);
        root.add(socketAnchor);

        const override = options.lightOverrides?.[socket.name];
        if (override === false) {
          // Socket light explicitly disabled by level config
          continue;
        }

        if (socket.recommendedLight) {
          const rec = socket.recommendedLight;
          const typeStr = (override?.type ?? rec.type).toLowerCase();
          const colorHex = override?.color ?? rec.color;
          const color = Color.fromHex(colorHex);
          const intensity = override?.intensity ?? rec.intensity;
          const distance = override?.distance ?? rec.distance;

          let light: AbstractLight | undefined;

          if (typeStr === "point" || typeStr === "pointlight") {
            light = new PointLight({
              name: `${socket.name}_Light`,
              color,
              intensity,
              distance,
            });
          } else if (typeStr === "spot" || typeStr === "spotlight") {
            light = new SpotLight({
              name: `${socket.name}_Light`,
              color,
              intensity,
              distance,
            });
          }

          if (light) {
            socketAnchor.add(light);
            lights.set(socket.name, light);
          }
        }
      }
    }

    return { root, meta, lights };
  }

  /**
   * Loads a declarative level descriptor from JSON or a passed LevelDescriptor object,
   * instantiating all props, lights, and environment elements into a parent root Object3D.
   */
  public async loadLevel(
    descriptorOrUrl: string | LevelDescriptor,
    targetScene?: Object3D | { add(obj: Object3D): void },
  ): Promise<LevelInstance> {
    let descriptor: LevelDescriptor;
    if (typeof descriptorOrUrl === "string") {
      descriptor = (await this._assetManager.loadJson(descriptorOrUrl)) as LevelDescriptor;
    } else {
      descriptor = descriptorOrUrl;
    }

    const levelRoot = new Object3D(descriptor.id || "LevelRoot");
    const propInstances = new Map<string, KitPropInstance>();
    const lightInstances = new Map<string, AbstractLight>();
    const decalInstances = new Map<string, Decal>();

    this._validateDecalPlacements(descriptor);

    // 1. Load Props in parallel
    const propPromises = descriptor.props.map(async (p) => {
      try {
        const loadOpts: LoadPropOptions = {};
        if (p.position) loadOpts.position = p.position;
        if (p.rotation) loadOpts.rotation = p.rotation;
        if (p.scale !== undefined) loadOpts.scale = p.scale;
        if (p.lightOverrides) loadOpts.lightOverrides = p.lightOverrides;
        if (p.materialOverrides) loadOpts.materialOverrides = p.materialOverrides;

        const inst = await this.loadProp(p.kitProp, loadOpts);
        inst.root.name = p.id;
        levelRoot.add(inst.root);
        propInstances.set(p.id, inst);
      } catch (err) {
        console.warn(`[KitRegistry] Failed to load level prop '${p.id}' (${p.kitProp}):`, err);
      }
    });

    // 2. Load Free / Narrative Lights
    if (descriptor.lights && Array.isArray(descriptor.lights)) {
      for (const lDef of descriptor.lights) {
        const color = lDef.color ? Color.fromHex(lDef.color) : new Color(1, 1, 1);
        let light: AbstractLight | undefined;

        switch (lDef.type) {
          case "spot": {
            const spotOpts: {
              name: string;
              color: Color;
              intensity: number;
              distance: number;
              angle?: number;
              penumbra?: number;
              decay?: number;
            } = {
              name: lDef.name,
              color,
              intensity: lDef.intensity ?? 1.0,
              distance: lDef.distance ?? 10.0,
            };
            if (lDef.angle !== undefined) spotOpts.angle = lDef.angle;
            if (lDef.penumbra !== undefined) spotOpts.penumbra = lDef.penumbra;
            if (lDef.decay !== undefined) spotOpts.decay = lDef.decay;

            light = new SpotLight(spotOpts);
            break;
          }
          case "point": {
            const ptOpts: {
              name: string;
              color: Color;
              intensity: number;
              distance: number;
              decay?: number;
            } = {
              name: lDef.name,
              color,
              intensity: lDef.intensity ?? 1.0,
              distance: lDef.distance ?? 8.0,
            };
            if (lDef.decay !== undefined) ptOpts.decay = lDef.decay;
            light = new PointLight(ptOpts);
            break;
          }
          case "directional": {
            const dirOpts: {
              name: string;
              color: Color;
              intensity: number;
              direction?: Vector3D;
            } = {
              name: lDef.name,
              color,
              intensity: lDef.intensity ?? 1.0,
            };
            if (lDef.direction) {
              dirOpts.direction = new Vector3D(
                lDef.direction[0],
                lDef.direction[1],
                lDef.direction[2],
              );
            }
            light = new DirectionalLight(dirOpts);
            break;
          }
          case "ambient":
            light = new AmbientLight({
              name: lDef.name,
              color,
              intensity: lDef.intensity ?? 0.3,
            });
            break;
        }

        if (light) {
          if (lDef.position) {
            light.position.set(lDef.position[0], lDef.position[1], lDef.position[2]);
          }
          if (lDef.target && light instanceof SpotLight) {
            light.lookAt(new Vector3D(lDef.target[0], lDef.target[1], lDef.target[2]));
          }
          levelRoot.add(light);
          lightInstances.set(lDef.name, light);
        }
      }
    }

    await Promise.all(propPromises);

    // 3. Decals (ADR 0029): after the props so `parent` can resolve to a prop instance root.
    for (const placement of descriptor.decals ?? []) {
      // Like props, a decal that cannot be built is skipped with a warning; it never takes the level down.
      let parentRoot: Object3D = levelRoot;
      if (placement.parent !== undefined) {
        const parentInst = propInstances.get(placement.parent);
        if (!parentInst) {
          console.warn(
            `[KitRegistry] Skipping decal '${placement.id}': parent prop '${placement.parent}' failed to load.`,
          );
          continue;
        }
        parentRoot = parentInst.root;
      }
      try {
        const decal = await this._createDecal(placement);
        parentRoot.add(decal);
        decalInstances.set(placement.id, decal);
      } catch (err) {
        console.warn(
          `[KitRegistry] Failed to load level decal '${placement.id}' (${placement.kitDecal}):`,
          err,
        );
      }
    }

    if (targetScene) {
      targetScene.add(levelRoot);
    }

    return {
      descriptor,
      root: levelRoot,
      props: propInstances,
      decals: decalInstances,
      lights: lightInstances,
      hotspots: descriptor.hotspots ?? [],
    };
  }

  /** Fails fast on placements that can never load: duplicate ids, bad size, unknown parent. */
  private _validateDecalPlacements(descriptor: LevelDescriptor): void {
    const propIds = new Set(descriptor.props.map((p) => p.id));
    const decalIds = new Set<string>();
    for (const d of descriptor.decals ?? []) {
      if (decalIds.has(d.id)) {
        throw new Error(`[KitRegistry] Duplicate decal id '${d.id}' in level '${descriptor.id}'.`);
      }
      decalIds.add(d.id);
      if (d.size && !d.size.every((v) => Number.isFinite(v) && v > 0)) {
        throw new Error(
          `[KitRegistry] Decal '${d.id}': size must be positive and finite, got [${d.size.join(", ")}].`,
        );
      }
      if (d.parent !== undefined && !propIds.has(d.parent)) {
        throw new Error(`[KitRegistry] Decal '${d.id}': unknown parent prop '${d.parent}'.`);
      }
    }
  }

  private async _loadDecalTexture(kitId: string, file: string): Promise<Texture> {
    const img = await this._assetManager.loadImage(`${this._basePath}${kitId}/decals/${file}`);
    return Texture.fromImage(img);
  }

  /** Finds the kit decal entry behind a namespaced id, loading the kit manifest on demand. */
  private async _findKitDecal(kitDecal: string, decalId: string): Promise<KitDecalItem> {
    const kitId = kitDecal.split("/")[0] ?? "";
    const manifest = await this.getKitManifest(kitId);
    const item = (manifest.decals ?? []).find((it) => it.id === kitDecal);
    if (!item) {
      throw new Error(
        `[KitRegistry] Decal '${decalId}': kit decal '${kitDecal}' not found in kit '${kitId}'.`,
      );
    }
    return item;
  }

  /** Loads the kit decal's maps into the decal's material (shared by level loading and `hydrateDecal`). */
  private async _loadDecalMaps(decal: Decal, item: KitDecalItem): Promise<void> {
    const kitId = item.id.split("/")[0] ?? "";
    const [diffuseMap, normalMap, ormMap, emissiveMap] = await Promise.all([
      this._loadDecalTexture(kitId, item.file),
      item.normal ? this._loadDecalTexture(kitId, item.normal) : undefined,
      item.orm ? this._loadDecalTexture(kitId, item.orm) : undefined,
      item.emission ? this._loadDecalTexture(kitId, item.emission) : undefined,
    ]);
    const material = decal.material as DecalMaterial;
    material.diffuseMap = diffuseMap;
    material.normalMap = normalMap;
    material.ormMap = ormMap;
    material.emissiveMap = emissiveMap;
    material.unlit = item.unlit ?? false;
  }

  /** Builds one decal from its placement and the kit decal it references. */
  private async _createDecal(placement: LevelDecalPlacement): Promise<Decal> {
    const item = await this._findKitDecal(placement.kitDecal, placement.id);
    const size = placement.size ?? item.size ?? [1, 1, 1];
    const decal = createDecalShell({ ...placement, size });
    await this._loadDecalMaps(decal, item);
    return decal;
  }

  /**
   * Fills a texture-less decal (e.g. one read from `SWM_decal`) with the maps and `unlit` flag of
   * its kit decal. Geometry, size, fade and opacity stay as they are. A decal without `kitDecal`,
   * with an unknown kit decal or with unloadable maps is skipped with a warning (it stays
   * invisible) and `false` is returned; it never throws.
   */
  public async hydrateDecal(decal: Decal): Promise<boolean> {
    if (decal.kitDecal === undefined) {
      console.warn(`[KitRegistry] Cannot hydrate decal '${decal.name}': it has no kitDecal.`);
      return false;
    }
    try {
      const item = await this._findKitDecal(decal.kitDecal, decal.name);
      await this._loadDecalMaps(decal, item);
      return true;
    } catch (err) {
      console.warn(
        `[KitRegistry] Failed to hydrate decal '${decal.name}' (${decal.kitDecal}):`,
        err,
      );
      return false;
    }
  }

  /** `hydrateDecal` for every `Decal` below `root` (e.g. a freshly loaded Maker scene); returns how many were hydrated. */
  public async resolveLevelDecals(root: Object3D): Promise<number> {
    const decals: Decal[] = [];
    root.traverse((o) => {
      if (o instanceof Decal) decals.push(o);
    });
    const results = await Promise.all(decals.map((d) => this.hydrateDecal(d)));
    return results.filter(Boolean).length;
  }
}
