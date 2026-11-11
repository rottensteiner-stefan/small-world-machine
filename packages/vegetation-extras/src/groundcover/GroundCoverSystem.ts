/**
 * Camera-centred ground cover over several varieties (ADR 0059 step 1b, source B).
 *
 * Industry model: Unreal Engine "Landscape Grass Type" (a list of grass varieties scattered
 * procedurally in a ring around the camera, density + distance thinning, no shadow casting) and
 * Unity's terrain detail layers. One `GroundCover` ring + one `InstanceFieldSystem` per variety:
 * field draw segments are (view x bucket), so a field draws ONE geometry per LOD bucket.
 * Rings rebuild on the CPU only after `updateStep` metres of camera travel (blade positions are
 * world-glued; only the distance thinning drifts), records upload through the zero-GC live path.
 */
import {
  InstanceFieldSystem,
  type FieldCanopy,
  type PrototypeDescriptor,
} from "@small-world-machine/engine";
import { GroundCover } from "./GroundCover.js";
import { buildGrassClumpGeometry, type GrassVariety } from "./GrassClump.js";

/** The renderer surface the system needs (WebGPU renderer). */
export interface InstanceFieldHost {
  registerInstanceField(system: InstanceFieldSystem): void;
  unregisterInstanceField(system: InstanceFieldSystem): void;
}

export interface GroundCoverSystemOptions {
  /** @domain Varieties (each gets its own ring + field). */
  varieties: readonly GrassVariety[];
  /** @domain Clumps per m² inside the full-density disc, split by each variety's `share`. */
  density: number;
  /** @domain Ring outer radius (m). */
  radius: number;
  /** @domain Base seed; variety `i` uses `seed + i * 97` (independent placements). */
  seed: number;
  /** @domain Tile edge of the rings (m). Default 5. */
  cellSize?: number;
  /** @domain Sub-pixel cull gate (px), must stay below `lodPx`. Default 2. */
  cullPixelSize?: number;
  /** @domain Projected size (px) between the sparse far clump and the full near clump. Default 14. */
  lodPx?: number;
  /** @domain Camera travel (m) that triggers a ring rebuild + upload. Default 0.5. */
  updateStep?: number;
  /** @domain Uniform scale range of the clumps. Default [0.7, 1.6]. */
  scaleRange?: readonly [number, number];
  /** @domain Radius of full density (m). Default min(140, 0.4 * radius). */
  fullDensityRadius?: number;
  /** @domain Density kept at the ring edge, [0, 1]. Default 0.3. */
  minDensity?: number;
  /** @domain Clear disc around the camera (m). Default 2. */
  cameraClearRadius?: number;
  /** @domain Canopy ambient occlusion shared with the tree field (ADR 0059 step 6a). */
  canopy?: FieldCanopy;
}

interface CoverLayer {
  readonly variety: GrassVariety;
  readonly cover: GroundCover;
  readonly system: InstanceFieldSystem;
}

export class GroundCoverSystem {
  private readonly _layers: CoverLayer[] = [];
  private readonly _updateStep: number;
  private _lastX = Number.POSITIVE_INFINITY;
  private _lastZ = Number.POSITIVE_INFINITY;
  private _host: InstanceFieldHost | undefined = undefined;

  constructor(options: GroundCoverSystemOptions) {
    const cell = options.cellSize ?? 5;
    const cullPx = options.cullPixelSize ?? 2;
    const lodPx = options.lodPx ?? 14;
    if (!(lodPx > cullPx)) {
      throw new Error("[GroundCoverSystem] lodPx must be greater than cullPixelSize.");
    }
    this._updateStep = options.updateStep ?? 0.5;
    options.varieties.forEach((variety, index) => {
      const cover = new GroundCover({
        radius: options.radius,
        cellSize: cell,
        bladesPerTile: Math.max(1, Math.round(options.density * variety.share * cell * cell)),
        seed: options.seed + index * 97,
        fullDensityRadius: options.fullDensityRadius ?? Math.min(140, options.radius * 0.4),
        minDensity: options.minDensity ?? 0.3,
        cameraClearRadius: options.cameraClearRadius ?? 2,
        scaleRange: options.scaleRange ?? [0.7, 1.6],
      });
      const prototype: PrototypeDescriptor = {
        id: `ground-cover-${variety.id}`,
        boundingRadius: Math.hypot(
          variety.height,
          variety.radius + variety.height * variety.lean[1],
        ),
        lodBuckets: [
          {
            name: "far",
            lodIndex: 1,
            minProjectedSize: cullPx + 1,
            maxProjectedSize: lodPx,
            geometrySlot: 0,
          },
          {
            name: "near",
            lodIndex: 0,
            minProjectedSize: lodPx + 1,
            maxProjectedSize: 1e6,
            geometrySlot: 1,
          },
        ],
        materialSlot: 0,
        maxInstances: cover.capacity,
      };
      const system = new InstanceFieldSystem(null, {
        instanceRecords: cover.records,
        prototypes: [prototype],
        geometryTable: [
          [
            buildGrassClumpGeometry(variety, index, variety.bladesFar),
            buildGrassClumpGeometry(variety, index, variety.blades),
          ],
        ],
        // Main view only: ground cover never lands in the shadow-map passes.
        options: {
          cellSize: cell,
          maxInstances: cover.capacity,
          cullPixelSize: cullPx,
          maxViews: 1,
        },
        ...(options.canopy ? { canopy: options.canopy } : {}),
      });
      this._layers.push({ variety, cover, system });
    });
  }

  /** Registers every variety field with the renderer. Returns the number registered; a variety the
   *  device cannot host is skipped (disposed) instead of failing the whole cover. */
  public register(host: InstanceFieldHost): number {
    this._host = host;
    let ok = 0;
    for (let i = this._layers.length - 1; i >= 0; i--) {
      const layer = this._layers[i]!;
      try {
        host.registerInstanceField(layer.system);
        ok++;
      } catch {
        layer.system.dispose();
        this._layers.splice(i, 1);
      }
    }
    return ok;
  }

  /** Rebuilds + uploads the rings when the camera moved `updateStep` m. Returns true on rebuild. */
  public update(cameraX: number, cameraZ: number): boolean {
    const dx = cameraX - this._lastX;
    const dz = cameraZ - this._lastZ;
    if (dx * dx + dz * dz < this._updateStep * this._updateStep) return false;
    this._lastX = cameraX;
    this._lastZ = cameraZ;
    for (const layer of this._layers) {
      layer.cover.update(cameraX, cameraZ);
      layer.system.setPopulationData(layer.cover.records.subarray(0, layer.cover.count * 4));
      layer.system.uploadRecords();
    }
    return true;
  }

  /** Shares a wind block with every variety (wind height = variety height); undefined = off. */
  public setWind(uniforms: Float32Array | undefined): void {
    for (const layer of this._layers) {
      layer.system.setWind(uniforms, uniforms ? layer.variety.height : 0);
    }
  }

  /** Live clump records over all varieties. */
  public get instanceCount(): number {
    let n = 0;
    for (const layer of this._layers) n += layer.system.instanceCount;
    return n;
  }

  /** Number of registered varieties. */
  public get varietyCount(): number {
    return this._layers.length;
  }

  /** Unregisters + disposes every field. Safe to call twice. */
  public dispose(): void {
    for (const layer of this._layers) {
      this._host?.unregisterInstanceField(layer.system);
      layer.system.dispose();
    }
    this._layers.length = 0;
    this._host = undefined;
  }
}
