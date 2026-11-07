import { ExtrudeGeometry } from "./ExtrudeGeometry.js";
import { Vector2D, MathUtils } from "../math/index.js";

/**
 * Options for a Gear geometry.
 */
export interface GearOptions {
  /** The number of teeth. Defaults to 10. */
  teeth?: number;
  /** The inner radius of the gear. Defaults to 1.0. */
  innerRadius?: number;
  /** The height of the teeth. Defaults to 0.5. */
  toothHeight?: number;
  /** The radius of the inner hole. Defaults to innerRadius / 4. */
  holeRadius?: number;
  /** The ratio between the outer top edge and inner base edge. Defaults to 0.5. */
  vRatio?: number;
  /** The thickness of the gear. Defaults to 0.5. */
  thickness?: number;
}

/**
 * Procedural Gear Geometry based on isosceles trapezoidal teeth.
 * @see Please refer to `REFERENCES.md#gear-zahnrad` for the underlying tooth calculation formulas.
 */
export class Gear extends ExtrudeGeometry {
  public readonly teeth: number;
  public readonly innerRadius: number;
  public readonly toothHeight: number;
  public readonly holeRadius: number;
  public readonly vRatio: number;

  constructor(options: GearOptions = {}) {
    const {
      teeth = 10,
      innerRadius = 1.0,
      toothHeight = 0.5,
      holeRadius = innerRadius / 4.0,
      vRatio = 0.5,
      thickness = 0.5,
    } = options;

    const clampedTeeth = Math.max(3, Math.floor(teeth));
    const clampedInnerRadius = Math.max(0.001, innerRadius);
    const clampedToothHeight = Math.max(0, toothHeight);
    const clampedHoleRadius = Math.max(0, Math.min(clampedInnerRadius * 0.9, holeRadius));
    const clampedVRatio = Math.max(0.001, vRatio);

    const { shape, innerShape } = Gear._generateShapes(
      clampedTeeth,
      clampedInnerRadius,
      clampedToothHeight,
      clampedHoleRadius,
      clampedVRatio,
    );

    super({ shape, innerShape, depth: Math.max(0.001, thickness) });

    this.teeth = clampedTeeth;
    this.innerRadius = clampedInnerRadius;
    this.toothHeight = clampedToothHeight;
    this.holeRadius = clampedHoleRadius;
    this.vRatio = clampedVRatio;
  }

  /**
   * Generates the 2D contour of the gear and its inner hole.
   */
  private static _generateShapes(
    teeth: number,
    r: number,
    i: number,
    holeRadius: number,
    v: number,
  ): { shape: Vector2D[]; innerShape: Vector2D[] } {
    const shape: Vector2D[] = [];
    const innerShape: Vector2D[] = [];
    const R = r + i;

    // Circumference base calculation for ratio
    const a = (MathUtils.TWO_PI * r * v) / (teeth * (v + 1.0));
    const b = a / v;

    const alphaBase = b / (2.0 * r);
    const alphaTop = a / (2.0 * R);
    const deltaTheta = MathUtils.TWO_PI / teeth;

    for (let k = 0; teeth > k; k++) {
      const theta = k * deltaTheta;

      // Point 1: Right base corner
      shape.push(new Vector2D(r * Math.cos(theta - alphaBase), r * Math.sin(theta - alphaBase)));

      // Point 2: Right top corner
      shape.push(new Vector2D(R * Math.cos(theta - alphaTop), R * Math.sin(theta - alphaTop)));

      // Point 3: Left top corner
      shape.push(new Vector2D(R * Math.cos(theta + alphaTop), R * Math.sin(theta + alphaTop)));

      // Point 4: Left base corner
      shape.push(new Vector2D(r * Math.cos(theta + alphaBase), r * Math.sin(theta + alphaBase)));

      // Inner shape (Hole) points at the same angles
      innerShape.push(
        new Vector2D(
          holeRadius * Math.cos(theta - alphaBase),
          holeRadius * Math.sin(theta - alphaBase),
        ),
      );
      innerShape.push(
        new Vector2D(
          holeRadius * Math.cos(theta - alphaTop),
          holeRadius * Math.sin(theta - alphaTop),
        ),
      );
      innerShape.push(
        new Vector2D(
          holeRadius * Math.cos(theta + alphaTop),
          holeRadius * Math.sin(theta + alphaTop),
        ),
      );
      innerShape.push(
        new Vector2D(
          holeRadius * Math.cos(theta + alphaBase),
          holeRadius * Math.sin(theta + alphaBase),
        ),
      );
    }

    return { shape, innerShape };
  }
}
