import { DROP_PRESETS, DropPreset, type DropProperties } from "./DropProperties.js";
import { createDropSurfaceParams, deriveSurfaceParams } from "./DropRegime.js";
import type { DropSurfaceParams } from "./DropSurfaceParams.js";
import { FLUID_PRESETS, FluidPreset, type FluidProperties } from "./FluidProperties.js";

/** A liquid surface that renders drop impacts from derived physics (e.g. `RainPuddleMaterial`). */
export interface DropImpactSurface {
  /**
   * The params object is owned and reused by the system; copy out what you keep, it is overwritten on
   * the next change.
   */
  setDropSurfaceParams(params: DropSurfaceParams): void;
}

export interface DropImpactSystemOptions {
  fluid?: Readonly<FluidProperties>;
  drops?: Readonly<DropProperties>;
}

/**
 * Drop impacts as a system rather than a per-liquid material (ADR 0042): event layers (rain, drips) plus
 * the liquid's material data are turned into regime and optics params once, then pushed to any number of
 * surfaces. Pairings are data: switching blood for water is assigning a different `fluid`, never code.
 */
export class DropImpactSystem {
  private _fluid: Readonly<FluidProperties>;
  private _drops: Readonly<DropProperties>;
  private _dirty: boolean = true;
  /** Separate from `_dirty`: reading `params` recomputes without notifying surfaces. */
  private _surfacesStale: boolean = true;
  private readonly _params: DropSurfaceParams = createDropSurfaceParams();
  private readonly _surfaces: DropImpactSurface[] = [];

  constructor(options: DropImpactSystemOptions = {}) {
    this._fluid = options.fluid ?? FLUID_PRESETS[FluidPreset.DEFAULT];
    this._drops = options.drops ?? DROP_PRESETS[DropPreset.DEFAULT];
  }

  public get fluid(): Readonly<FluidProperties> {
    return this._fluid;
  }

  public set fluid(value: Readonly<FluidProperties>) {
    this._fluid = value;
    this._dirty = true;
    this._surfacesStale = true;
  }

  public get drops(): Readonly<DropProperties> {
    return this._drops;
  }

  public set drops(value: Readonly<DropProperties>) {
    this._drops = value;
    this._dirty = true;
    this._surfacesStale = true;
  }

  /** Current derived params; same reuse contract as {@link DropImpactSurface.setDropSurfaceParams}. */
  public get params(): DropSurfaceParams {
    this._refresh();
    return this._params;
  }

  public addSurface(surface: DropImpactSurface): void {
    if (this._surfaces.includes(surface)) {
      return;
    }
    this._surfaces.push(surface);
    surface.setDropSurfaceParams(this.params);
  }

  public removeSurface(surface: DropImpactSurface): void {
    const index = this._surfaces.indexOf(surface);
    if (index < 0) {
      return;
    }
    this._surfaces.splice(index, 1);
  }

  /** Recomputes and pushes only after `fluid` or `drops` changed; cheap to call every frame. */
  public apply(): void {
    if (!this._surfacesStale) {
      return;
    }
    this._surfacesStale = false;
    this._refresh();
    const surfaces = this._surfaces;
    for (let i = 0; i < surfaces.length; i++) {
      surfaces[i]!.setDropSurfaceParams(this._params);
    }
  }

  private _refresh(): void {
    if (!this._dirty) {
      return;
    }
    deriveSurfaceParams(this._fluid, this._drops, this._params);
    this._dirty = false;
  }
}
