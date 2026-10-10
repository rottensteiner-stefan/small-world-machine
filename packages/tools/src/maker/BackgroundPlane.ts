import { Object3D, Plane, BasicMaterial, Texture } from "@small-world-machine/engine";

export interface BackgroundPlaneOptions {
  name?: string;
  texture: Texture;
  width: number;
  height: number;
}

/**
 * A reference-image plane for tracing 2.5D stage zones on top of (ADR 0016 Phase 2). A distinct
 * `Object3D` subtype (rather than a plain `Object3D` with geometry/material set ad hoc) so
 * `StageProjectionResolver` can find it via a reliable `instanceof` check, the same way
 * `StageZoneMarker` gives zones a reliable node identity.
 */
export class BackgroundPlane extends Object3D {
  /** Kept alongside the generated geometry so `StageProjectionResolver` can derive a (u, v) ->
   * world mapping without having to reverse-engineer it from the vertex buffer. */
  public readonly width: number;
  public readonly height: number;

  constructor(options: BackgroundPlaneOptions) {
    super(options.name ?? "Background");
    this.width = options.width;
    this.height = options.height;
    this.geometry = new Plane({ width: options.width, height: options.height }).getGeometryData();
    const material = new BasicMaterial({ diffuseMap: options.texture });
    // A reference image sits behind/at the zones it's traced for -- must never occlude them via
    // depth, matching `flakturm-tunnel`'s own hand-authored background plane convention.
    material.depthWrite = false;
    this.material = material;
  }
}
