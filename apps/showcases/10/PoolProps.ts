import type { Texture } from "@small-world-machine/engine";
import {
  Color,
  Cube,
  Cylinder,
  LambertMaterial,
  Object3D,
  Octahedron,
  Sphere,
  WorldMaterial,
} from "@small-world-machine/engine";
import { createBuoyTexture, createWoodCrateTexture } from "./PoolTextures.js";

export type BarrelType = "hazard" | "oil" | "chemical";

/** Linear RGB, 0..1. */
export type Rgb = readonly [number, number, number];

/** Declarative description of one pool prop; `PoolProps.create` turns it into an Object3D. */
export type PropSpec =
  | { kind: "crate"; color?: Rgb }
  | { kind: "ball"; color: Rgb; radius: number }
  | { kind: "debris"; color: Rgb; radius: number }
  | { kind: "barrel"; type: BarrelType }
  | { kind: "buoy"; bodyColor: Rgb; mastColor: Rgb }
  | { kind: "gear"; color: Rgb }
  | { kind: "pipe"; color: Rgb };

const BALL_BELT_COLOR = "#141416";
const BALL_BOTTOM_COLOR = "#ffffff";
const BARREL_SCALE = 0.82;

function toColor(rgb: Rgb): Color {
  return new Color(rgb[0], rgb[1], rgb[2]);
}

/** Builds the crates, balls, barrels and industrial scrap that sit and float in the pools. */
export class PoolProps {
  private _crateTexture: Texture | undefined;
  private readonly _buoyTextures: Map<string, Texture> = new Map();

  constructor(private readonly _barrelTemplates: Readonly<Record<BarrelType, Object3D>>) {}

  public create(spec: PropSpec): Object3D {
    switch (spec.kind) {
      case "crate":
        return this._makeCrate(spec.color);
      case "ball":
        return this._makeBall(toColor(spec.color), spec.radius);
      case "debris":
        return this._makeDebris(toColor(spec.color), spec.radius);
      case "barrel":
        return this._makeBarrel(spec.type);
      case "buoy":
        return this._makeMetallicBuoy(toColor(spec.bodyColor), toColor(spec.mastColor));
      case "gear":
        return this._makeIndustrialGear(toColor(spec.color));
      case "pipe":
        return this._makeIndustrialPipe(toColor(spec.color));
    }
  }

  private _makeCrate(rgb?: Rgb): Object3D {
    const crate = new Object3D("Crate");
    crate.geometry = new Cube({ size: 0.6 }).getGeometryData();
    crate.castShadow = true;
    crate.receiveShadow = true;
    this._crateTexture ??= createWoodCrateTexture();
    crate.material = new LambertMaterial({
      diffuseMap: this._crateTexture,
      color: rgb ? toColor(rgb) : Color.WHITE,
    });
    return crate;
  }

  private _makeBall(color: Color, radius: number): Object3D {
    const ball = new Object3D("Ball");
    ball.geometry = new Sphere({
      radius,
      widthSegments: 24,
      heightSegments: 16,
    }).getGeometryData();
    ball.castShadow = true;
    ball.receiveShadow = true;
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    ball.material = new LambertMaterial({
      diffuseMap: this._getBuoyTexture(`rgb(${r},${g},${b})`),
    });
    // Tilted so the equator belt stays visible from the top-down camera instead of hiding at the silhouette.
    ball.rotation.set(1.0, -Math.PI / 2, 0.5);
    return ball;
  }

  private _getBuoyTexture(topColor: string): Texture {
    let texture = this._buoyTextures.get(topColor);
    if (undefined === texture) {
      texture = createBuoyTexture(topColor, BALL_BOTTOM_COLOR, BALL_BELT_COLOR);
      this._buoyTextures.set(topColor, texture);
    }
    return texture;
  }

  private _makeDebris(color: Color, radius: number): Object3D {
    const debris = new Object3D("Debris");
    debris.geometry = new Octahedron({ radius }).getGeometryData();
    debris.castShadow = true;
    debris.receiveShadow = true;
    debris.material = new WorldMaterial({ color });
    return debris;
  }

  private _makeBarrel(type: BarrelType): Object3D {
    const barrel = this._barrelTemplates[type].clone();
    barrel.scale.set(BARREL_SCALE, BARREL_SCALE, BARREL_SCALE);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    return barrel;
  }

  private _makeMetallicBuoy(bodyColor: Color, mastColor: Color): Object3D {
    const root = new Object3D("MetallicBuoy");
    root.castShadow = true;
    root.receiveShadow = true;

    const sphere = new Object3D("BuoySphere");
    sphere.geometry = new Sphere({
      radius: 0.34,
      widthSegments: 16,
      heightSegments: 12,
    }).getGeometryData();
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    sphere.material = new WorldMaterial({
      color: bodyColor,
    });
    root.add(sphere);

    const ring = new Object3D("BuoyRing");
    ring.geometry = new Cylinder({
      radiusTop: 0.37,
      radiusBottom: 0.37,
      height: 0.08,
      radialSegments: 16,
    }).getGeometryData();
    ring.castShadow = true;
    ring.receiveShadow = true;
    ring.material = new WorldMaterial({
      color: new Color(0.12, 0.12, 0.15),
    });
    root.add(ring);

    const mast = new Object3D("BuoyMast");
    mast.geometry = new Cylinder({
      radiusTop: 0.02,
      radiusBottom: 0.03,
      height: 0.35,
      radialSegments: 8,
    }).getGeometryData();
    mast.position.set(0, 0.4, 0);
    mast.castShadow = true;
    mast.receiveShadow = true;
    mast.material = new WorldMaterial({
      color: mastColor,
    });
    root.add(mast);

    return root;
  }

  private _makeIndustrialGear(color: Color): Object3D {
    const root = new Object3D("IndustrialGear");
    root.castShadow = true;
    root.receiveShadow = true;

    const gearMat = new WorldMaterial({
      color,
    });

    const hub = new Object3D("GearHub");
    hub.geometry = new Cylinder({
      radiusTop: 0.4,
      radiusBottom: 0.4,
      height: 0.12,
      radialSegments: 12,
    }).getGeometryData();
    hub.castShadow = true;
    hub.receiveShadow = true;
    hub.material = gearMat;
    root.add(hub);

    for (let i = 0; i < 6; i++) {
      const tooth = new Object3D(`Tooth_${i}`);
      tooth.geometry = new Cube({ size: 1 }).getGeometryData();
      tooth.scale.set(0.14, 0.12, 0.16);
      const angle = (i / 6) * Math.PI * 2;
      tooth.position.set(Math.cos(angle) * 0.42, 0, Math.sin(angle) * 0.42);
      tooth.rotation.y = -angle;
      tooth.castShadow = true;
      tooth.receiveShadow = true;
      tooth.material = gearMat;
      root.add(tooth);
    }
    return root;
  }

  private _makeIndustrialPipe(color: Color): Object3D {
    const root = new Object3D("IndustrialPipe");
    root.castShadow = true;
    root.receiveShadow = true;

    const pipeMat = new WorldMaterial({
      color,
    });
    const flangeMat = new WorldMaterial({
      color: new Color(0.18, 0.2, 0.22),
    });

    const pipe = new Object3D("PipeMain");
    pipe.geometry = new Cylinder({
      radiusTop: 0.2,
      radiusBottom: 0.2,
      height: 1.1,
      radialSegments: 14,
    }).getGeometryData();
    pipe.rotation.z = Math.PI * 0.5;
    pipe.castShadow = true;
    pipe.receiveShadow = true;
    pipe.material = pipeMat;
    root.add(pipe);

    const flange1 = new Object3D("Flange1");
    flange1.geometry = new Cylinder({
      radiusTop: 0.28,
      radiusBottom: 0.28,
      height: 0.08,
      radialSegments: 14,
    }).getGeometryData();
    flange1.position.set(-0.5, 0, 0);
    flange1.rotation.z = Math.PI * 0.5;
    flange1.castShadow = true;
    flange1.receiveShadow = true;
    flange1.material = flangeMat;
    root.add(flange1);

    const flange2 = new Object3D("Flange2");
    flange2.geometry = new Cylinder({
      radiusTop: 0.28,
      radiusBottom: 0.28,
      height: 0.08,
      radialSegments: 14,
    }).getGeometryData();
    flange2.position.set(0.5, 0, 0);
    flange2.rotation.z = Math.PI * 0.5;
    flange2.castShadow = true;
    flange2.receiveShadow = true;
    flange2.material = flangeMat;
    root.add(flange2);

    return root;
  }
}
