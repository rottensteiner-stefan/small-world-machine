import {
  type Object3D,
  AbstractLight,
  type Camera,
  type Scene,
  Vector3D,
} from "@small-world-machine/engine";
import type { MakerApp } from "./MakerApp.js";

/** Configuration for spawning a prop via the Maker public API. */
export interface LoadPropApiOptions {
  position?: Vector3D | { x: number; y: number; z: number };
  rotationY?: number;
  scale?: number;
  select?: boolean;
}

/** Definition of a character in the lineup. */
export interface CharacterLineupEntry {
  id: string;
  name: string;
  x: number;
  scale?: number;
}

/** Default public fallback list of humanoid characters for the lineup. */
export const DEFAULT_CHARACTER_LINEUP: readonly CharacterLineupEntry[] = [
  { id: "characters/player_male", name: "Player Male", x: -1.1, scale: 1.0 },
  { id: "characters/player_female", name: "Player Female", x: 0.0, scale: 1.0 },
  { id: "characters/spacegirl", name: "SpaceGirl", x: 1.1, scale: 1.0 },
] as const;

/**
 * Public Developer & Scripting API for Small World Machine Maker.
 * Accessible at runtime via `window.maker` (and `makerApp.api`).
 */
export class MakerApi {
  constructor(private readonly _app: MakerApp) {}

  /** Underlying MakerApp engine/editor host. */
  public get app(): MakerApp {
    return this._app;
  }

  /** The active 3D scene. */
  public get scene(): Scene {
    return this._app.scene;
  }

  /** The primary viewport camera. */
  public get camera(): Camera {
    return this._app.camera;
  }

  /** Read-only set of currently selected objects. */
  public get selection(): ReadonlySet<Object3D> {
    return this._app.selection;
  }

  /** The primary selected object (last selected). */
  public get primary(): Object3D | undefined {
    return this._app.primary;
  }

  /**
   * Spawns a kit prop or character by ID (e.g. "characters/spacegirl", "characters/player_male", "industrial/wall_lamp").
   * Resolves the GLB, applies recommended metadata scale, sets transforms, and adds it to the scene.
   */
  public async loadProp(
    kitPropId: string,
    options: LoadPropApiOptions = {},
  ): Promise<Object3D | undefined> {
    try {
      const instance = await this._app.kitRegistry.loadProp(kitPropId, {
        ...(options.scale !== undefined ? { scale: options.scale } : {}),
      });
      const root = instance.root;

      if (options.position) {
        root.position.set(options.position.x, options.position.y, options.position.z);
      }
      if (options.rotationY !== undefined) {
        root.rotation.y = options.rotationY;
      }
      root.updateMatrixWorld();

      this._app.addObject(root, { spawn: !options.position });

      if (options.select !== false) {
        this._app.selectObject(root);
      }

      return root;
    } catch (err) {
      console.error(`[MakerApi] Failed to load prop '${kitPropId}':`, err);
      return undefined;
    }
  }

  /**
   * Spawns rigged humanoid figures from the `characters` kit manifest in a centered lineup
   * grounded at Y = 0, facing forward (+Z), and frames the orbit camera for studio inspection.
   */
  public async loadCharacterLineup(options: { clear?: boolean } = {}): Promise<Object3D[]> {
    if (options.clear !== false) {
      this.clearUserObjects();
    }

    let lineup: readonly CharacterLineupEntry[] = DEFAULT_CHARACTER_LINEUP;
    try {
      const manifest = await this._app.kitRegistry.getKitManifest("characters");
      const items = (manifest.items ?? []).filter((it) => it.id !== "characters/fox");
      if (items.length > 0) {
        const spacing = 1.1;
        const startX = -((items.length - 1) * spacing) / 2;
        lineup = items.map((it, idx) => ({
          id: it.id,
          name: it.name,
          x: +(startX + idx * spacing).toFixed(3),
          scale: 1.0,
        }));
      }
    } catch {
      // Fall back to DEFAULT_CHARACTER_LINEUP when local characters kit manifest is unavailable
    }

    const spawned: Object3D[] = [];
    for (const entry of lineup) {
      const prop = await this.loadProp(entry.id, {
        position: { x: entry.x, y: 0, z: 0 },
        rotationY: 0,
        ...(entry.scale !== undefined ? { scale: entry.scale } : {}),
        select: false,
      });
      if (prop) {
        prop.name = entry.name;
        spawned.push(prop);
      }
    }

    // Set orbit camera view to nicely frame the lineup
    this._app.orbit.setView({
      target: new Vector3D(0, 0.9, 0),
      distance: 5.2,
      yaw: 0.0,
      pitch: 0.12,
    });

    console.log(`[MakerApi] Successfully loaded ${spawned.length} figures into the scene.`);
    return spawned;
  }

  /** Alias for loadCharacterLineup. */
  public async loadFigures(): Promise<Object3D[]> {
    return this.loadCharacterLineup();
  }

  /**
   * Returns all user-created objects currently in the scene (excluding grid, helpers, gizmos, and scene lights).
   */
  public getUserObjects(): Object3D[] {
    const root = this._app.scene.root;
    return root.children.filter(
      (child) => !this._app.isEditorHelper(child) && !(child instanceof AbstractLight),
    );
  }

  /**
   * Removes all user-created objects from the scene.
   */
  public clearUserObjects(): void {
    const objects = this.getUserObjects();
    for (const obj of objects) {
      this._app.scene.remove(obj);
    }
    this._app.selectObject(undefined);
  }

  /**
   * Selects an object by instance, name, or UUID. Pass undefined/null to clear selection.
   */
  public select(target?: Object3D | string | null): void {
    if (!target) {
      this._app.selectObject(undefined);
      return;
    }
    if (typeof target === "string") {
      const found = this.getUserObjects().find((obj) => obj.name === target || obj.uuid === target);
      this._app.selectObject(found);
    } else {
      this._app.selectObject(target);
    }
  }

  /**
   * Deselects all objects.
   */
  public deselect(): void {
    this._app.selectObject(undefined);
  }

  /**
   * Focuses the camera target on the specified object or currently selected primary object.
   */
  public focus(target?: Object3D | null): void {
    const obj = target ?? this._app.primary;
    if (obj) {
      this._app.orbit.target.copyFrom(obj.position);
    } else {
      this._app.orbit.target.set(0, 0.8, 0);
    }
  }

  /**
   * Switches Maker mode ("world", "xtractor", "pixler", "map", "material", "ibl", "kit").
   */
  public setMode(modeId: string): void {
    this._app.launchMode(modeId);
  }
}
