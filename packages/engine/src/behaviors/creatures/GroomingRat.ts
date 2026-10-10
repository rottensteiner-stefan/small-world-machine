import { Object3D } from "../../core/Object3D.js";
import { Color } from "../../core/colors/Color.js";
import { Sphere } from "../../geometry/Sphere.js";
import { Cube } from "../../geometry/Cube.js";
import { Cylinder } from "../../geometry/Cylinder.js";
import { StandardMaterial } from "../../core/materials/surface/StandardMaterial.js";
import { RatGroomingBehavior, RatGroomingBehaviorOptions } from "./RatGroomingBehavior.js";

export interface GroomingRatOptions {
  furColor?: Color | string;
  skinColor?: Color | string;
  eyeColor?: Color | string;
  scale?: number;
  enableBehavior?: boolean;
  behaviorOptions?: RatGroomingBehaviorOptions;
}

/**
 * Reusable articulated 3D Grooming Rat for Small World Machine.
 * Features realistic posture, shiny ruby eyes, pink snout/ears/paws,
 * and an integrated RatGroomingBehavior that drives a 3-phase grooming
 * state machine (face scrubbing, alert sniffing, ear cleaning).
 */
export class GroomingRat extends Object3D {
  public readonly behavior: RatGroomingBehavior | undefined;

  constructor(options?: GroomingRatOptions) {
    super("GroomingRat");

    const furColor =
      typeof options?.furColor === "string"
        ? Color.fromHex(options.furColor)
        : options?.furColor || new Color(0.24, 0.22, 0.2);

    const skinColor =
      typeof options?.skinColor === "string"
        ? Color.fromHex(options.skinColor)
        : options?.skinColor || new Color(0.88, 0.58, 0.58);

    const eyeColor =
      typeof options?.eyeColor === "string"
        ? Color.fromHex(options.eyeColor)
        : options?.eyeColor || new Color(1.0, 0.05, 0.05);

    const ratMat = new StandardMaterial({
      color: furColor,
      roughness: 0.92,
      metallic: 0.02,
    });

    const pinkMat = new StandardMaterial({
      color: skinColor,
      roughness: 0.45,
      metallic: 0.05,
    });

    const eyeMat = new StandardMaterial({
      color: eyeColor,
      roughness: 0.1,
      metallic: 0.8,
    });

    // Haunches / Sitting Pelvis Base
    const haunches = new Object3D("Haunches");
    haunches.geometry = new Sphere({
      radius: 0.065,
      widthSegments: 12,
      heightSegments: 10,
    }).getGeometryData();
    haunches.material = ratMat;
    haunches.scale.set(1.1, 0.9, 1.2);
    haunches.position.set(0, 0.045, -0.02);
    this.add(haunches);

    // Torso (Angled upright)
    const torso = new Object3D("Torso");
    torso.geometry = new Sphere({
      radius: 0.055,
      widthSegments: 12,
      heightSegments: 10,
    }).getGeometryData();
    torso.material = ratMat;
    torso.scale.set(0.9, 1.2, 0.95);
    torso.position.set(0, 0.09, 0.02);
    torso.rotation.x = -0.25;
    this.add(torso);

    // Hind Feet
    for (const side of [-0.05, 0.05]) {
      const foot = new Object3D("HindFoot_" + (side < 0 ? "L" : "R"));
      foot.geometry = new Cube({ size: 1.0 }).getGeometryData();
      foot.scale.set(0.025, 0.012, 0.06);
      foot.material = pinkMat;
      foot.position.set(side, 0.008, 0.03);
      this.add(foot);
    }

    // Head Assembly (articulated pivot)
    const head = new Object3D("Head");
    head.position.set(0, 0.145, 0.04);
    this.add(head);

    const skull = new Object3D("Skull");
    skull.geometry = new Sphere({
      radius: 0.04,
      widthSegments: 12,
      heightSegments: 10,
    }).getGeometryData();
    skull.material = ratMat;
    skull.scale.set(0.88, 0.88, 1.2);
    head.add(skull);

    const snout = new Object3D("Snout");
    snout.geometry = new Sphere({
      radius: 0.022,
      widthSegments: 8,
      heightSegments: 6,
    }).getGeometryData();
    snout.material = pinkMat;
    snout.scale.set(0.7, 0.65, 1.3);
    snout.position.set(0, -0.01, 0.045);
    head.add(snout);

    // Ears
    for (const side of [-0.032, 0.032]) {
      const ear = new Object3D("Ear_" + (side < 0 ? "L" : "R"));
      ear.geometry = new Sphere({
        radius: 0.016,
        widthSegments: 8,
        heightSegments: 6,
      }).getGeometryData();
      ear.scale.set(0.8, 1.2, 0.3);
      ear.material = pinkMat;
      ear.position.set(side, 0.025, -0.01);
      head.add(ear);
    }

    // Ruby Eyes
    for (const side of [-0.024, 0.024]) {
      const eye = new Object3D("Eye_" + (side < 0 ? "L" : "R"));
      eye.geometry = new Sphere({
        radius: 0.007,
        widthSegments: 6,
        heightSegments: 6,
      }).getGeometryData();
      eye.material = eyeMat;
      eye.position.set(side, 0.012, 0.028);
      head.add(eye);
    }

    // Front Paws (articulated for grooming)
    const leftPaw = new Object3D("LeftPaw");
    leftPaw.geometry = new Sphere({
      radius: 0.012,
      widthSegments: 6,
      heightSegments: 6,
    }).getGeometryData();
    leftPaw.material = pinkMat;
    leftPaw.scale.set(0.9, 0.7, 1.4);
    leftPaw.position.set(-0.02, 0.08, 0.05);
    this.add(leftPaw);

    const rightPaw = new Object3D("RightPaw");
    rightPaw.geometry = new Sphere({
      radius: 0.012,
      widthSegments: 6,
      heightSegments: 6,
    }).getGeometryData();
    rightPaw.material = pinkMat;
    rightPaw.scale.set(0.9, 0.7, 1.4);
    rightPaw.position.set(0.02, 0.08, 0.05);
    this.add(rightPaw);

    // 6-Segment Spline Tail
    let tZ = -0.07;
    for (let s = 0; s < 6; s++) {
      const seg = new Object3D(`Tail_${s}`);
      seg.geometry = new Cylinder({
        radiusTop: 0.011 - s * 0.0014,
        radiusBottom: 0.009 - s * 0.0014,
        height: 0.055,
        radialSegments: 8,
      }).getGeometryData();
      seg.material = pinkMat;
      seg.rotation.x = Math.PI / 2;
      seg.position.set(0.01 * s, 0.02 - s * 0.006, tZ);
      this.add(seg);
      tZ -= 0.048;
    }

    if (options?.scale !== undefined) {
      this.scale.set(options.scale, options.scale, options.scale);
    }

    if (options?.enableBehavior !== false) {
      const behavior = new RatGroomingBehavior(options?.behaviorOptions);
      this.addBehavior(behavior);
      this.behavior = behavior;
    }
  }
}
