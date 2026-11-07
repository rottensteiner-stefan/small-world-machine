import { Object3D } from "./Object3D.js";
import type { InspectorField } from "./Inspectable.js";
import { Capsule, Cone } from "../geometry/index.js";
import { WireframeMaterial, BasicMaterial } from "./materials/index.js";
import { Color } from "./colors/index.js";

export interface SpawnPointOptions {
  name?: string;
  tag?: string;
  spawnRadius?: number;
}

/**
 * Represents a player / entity spawn location in the scene graph.
 * Features a standard 1.8m wireframe player silhouette and forward direction indicator
 * for instant scale reference and spawn orientation in the editor.
 */
export class SpawnPoint extends Object3D {
  /** Inspector schema for SpawnPoint properties. */
  public static override readonly inspector: Record<string, InspectorField> = {
    tag: { type: "string", label: "Spawn Tag" },
    spawnRadius: { type: "number", label: "Spawn Radius", min: 0, max: 20, step: 0.1 },
  };

  public override tag: string;
  public spawnRadius: number;

  constructor(options: SpawnPointOptions = {}) {
    const { name = "SpawnPoint", tag = "default", spawnRadius = 0 } = options;
    super(name);
    this.tag = tag;
    this.spawnRadius = spawnRadius;

    // 1.8m tall human player capsule (radius 0.35m, cylinder length 1.1m)
    this.geometry = new Capsule({ radius: 0.35, length: 1.1 }).getGeometryData();
    this.material = new WireframeMaterial(new Color(0.1, 0.95, 0.45)); // Emerald Green

    // Forward direction cone pointing along -Z (Small World Machine forward vector)
    const arrow = new Object3D("SpawnDirection");
    arrow.geometry = new Cone({ radius: 0.12, height: 0.35 }).getGeometryData();
    arrow.material = new BasicMaterial({ color: new Color(0.1, 0.95, 0.45) });
    arrow.position.set(0, 0.5, -0.45);
    arrow.rotation.set(Math.PI / 2, 0, 0);
    this.add(arrow);
  }
}
