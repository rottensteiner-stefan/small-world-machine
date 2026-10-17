import { AbstractGeometry } from "./AbstractGeometry.js";
import type { Vector2D } from "../math/index.js";

/**
 * Options for ExtrudeGeometry.
 */
export interface ExtrudeGeometryOptions {
  /** The 2D shape defined by a sequence of points. Must form a closed contour around the origin (0,0). */
  shape: Vector2D[];
  /** Optional inner shape to create a hole. Must have the same number of points as shape. */
  innerShape?: Vector2D[];
  /** The depth/thickness to extrude along the Z-axis. Defaults to 1. */
  depth?: number;
}

/**
 * Geometry created by extruding a star-shaped 2D polygon along the Z-axis.
 */
export class ExtrudeGeometry extends AbstractGeometry {
  public readonly shape: Vector2D[];
  public readonly innerShape: Vector2D[] | undefined;
  public readonly depth: number;

  constructor(options: ExtrudeGeometryOptions) {
    super();
    this.shape = options.shape;
    this.innerShape = options.innerShape;
    this.depth = options.depth ?? 1;
    this.generateGeometryData();
  }

  /** @inheritdoc */
  protected override generateGeometryData(): void {
    const v: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const wireframeLines: number[] = [];
    const hh = this.depth / 2.0;
    const len = this.shape.length;

    if (3 > len) {
      return;
    }

    let vOffset = 0;

    // Calculate rough bounding box for UV mapping of front/back
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const pt of this.shape) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    const widthX = maxX - minX || 1;
    const widthY = maxY - minY || 1;

    // --- FRONT FACE ---
    if (!this.innerShape) {
      // Center point for triangle fan
      v.push(0, 0, hh);
      uv.push(0.5, 0.5);
      const frontCenterIdx = vOffset++;

      for (let i = 0; len > i; i++) {
        const pt = this.shape[i]!;
        v.push(pt.x, pt.y, hh);
        uv.push((pt.x - minX) / widthX, (pt.y - minY) / widthY);
        vOffset++;
      }

      for (let i = 0; len > i; i++) {
        const nextI = (i + 1) % len;
        // Front faces CCW (+Z outward)
        idx.push(frontCenterIdx, frontCenterIdx + 1 + i, frontCenterIdx + 1 + nextI);
        wireframeLines.push(frontCenterIdx + 1 + i, frontCenterIdx + 1 + nextI);
      }
    } else {
      const frontOuterIdx = vOffset;
      for (let i = 0; len > i; i++) {
        const pt = this.shape[i]!;
        v.push(pt.x, pt.y, hh);
        uv.push((pt.x - minX) / widthX, (pt.y - minY) / widthY);
        vOffset++;
      }
      const frontInnerIdx = vOffset;
      for (let i = 0; len > i; i++) {
        const pt = this.innerShape[i]!;
        v.push(pt.x, pt.y, hh);
        uv.push((pt.x - minX) / widthX, (pt.y - minY) / widthY);
        vOffset++;
      }
      for (let i = 0; len > i; i++) {
        const nextI = (i + 1) % len;
        const outer1 = frontOuterIdx + i;
        const outer2 = frontOuterIdx + nextI;
        const inner1 = frontInnerIdx + i;
        const inner2 = frontInnerIdx + nextI;
        idx.push(outer1, outer2, inner2);
        idx.push(outer1, inner2, inner1);
        wireframeLines.push(outer1, outer2);
        wireframeLines.push(inner1, inner2);
      }
    }

    // --- BACK FACE ---
    if (!this.innerShape) {
      v.push(0, 0, -hh);
      uv.push(0.5, 0.5);
      const backCenterIdx = vOffset++;

      for (let i = 0; len > i; i++) {
        const pt = this.shape[i]!;
        v.push(pt.x, pt.y, -hh);
        // Mirrored X for backface UV
        uv.push(1.0 - (pt.x - minX) / widthX, (pt.y - minY) / widthY);
        vOffset++;
      }

      for (let i = 0; len > i; i++) {
        const nextI = (i + 1) % len;
        // Back faces CW (-Z outward) => reverse winding
        idx.push(backCenterIdx, backCenterIdx + 1 + nextI, backCenterIdx + 1 + i);
        wireframeLines.push(backCenterIdx + 1 + i, backCenterIdx + 1 + nextI);
      }
    } else {
      const backOuterIdx = vOffset;
      for (let i = 0; len > i; i++) {
        const pt = this.shape[i]!;
        v.push(pt.x, pt.y, -hh);
        uv.push(1.0 - (pt.x - minX) / widthX, (pt.y - minY) / widthY);
        vOffset++;
      }
      const backInnerIdx = vOffset;
      for (let i = 0; len > i; i++) {
        const pt = this.innerShape[i]!;
        v.push(pt.x, pt.y, -hh);
        uv.push(1.0 - (pt.x - minX) / widthX, (pt.y - minY) / widthY);
        vOffset++;
      }
      for (let i = 0; len > i; i++) {
        const nextI = (i + 1) % len;
        const outer1 = backOuterIdx + i;
        const outer2 = backOuterIdx + nextI;
        const inner1 = backInnerIdx + i;
        const inner2 = backInnerIdx + nextI;
        idx.push(outer1, inner2, outer2);
        idx.push(outer1, inner1, inner2);
        wireframeLines.push(outer1, outer2);
        wireframeLines.push(inner1, inner2);
      }
    }

    // --- SIDE WALLS ---
    // We treat the perimeter as length 1 for UV mapping along the side
    // Distance along perimeter:
    let totalDist = 0;
    const distances = [0];
    for (let i = 0; len > i; i++) {
      const pt1 = this.shape[i]!;
      const pt2 = this.shape[(i + 1) % len]!;
      const dx = pt2.x - pt1.x;
      const dy = pt2.y - pt1.y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
      distances.push(totalDist);
    }

    let sideVOffset = vOffset;
    for (let i = 0; len > i; i++) {
      const pt1 = this.shape[i]!;
      const pt2 = this.shape[(i + 1) % len]!;

      v.push(pt1.x, pt1.y, hh); // 0: front-left
      v.push(pt2.x, pt2.y, hh); // 1: front-right
      v.push(pt1.x, pt1.y, -hh); // 2: back-left
      v.push(pt2.x, pt2.y, -hh); // 3: back-right

      const u1 = totalDist > 0 ? distances[i]! / totalDist : 0;
      const u2 = totalDist > 0 ? distances[i + 1]! / totalDist : 0;

      uv.push(u1, 1);
      uv.push(u2, 1);
      uv.push(u1, 0);
      uv.push(u2, 0);

      // Winding: 0->2->1 and 1->2->3
      idx.push(sideVOffset + 0, sideVOffset + 2, sideVOffset + 1);
      idx.push(sideVOffset + 1, sideVOffset + 2, sideVOffset + 3);

      wireframeLines.push(sideVOffset + 0, sideVOffset + 2); // vertical edge

      sideVOffset += 4;
    }

    if (this.innerShape) {
      let innerTotalDist = 0;
      const innerDistances = [0];
      for (let i = 0; len > i; i++) {
        const pt1 = this.innerShape[i]!;
        const pt2 = this.innerShape[(i + 1) % len]!;
        const dx = pt2.x - pt1.x;
        const dy = pt2.y - pt1.y;
        innerTotalDist += Math.sqrt(dx * dx + dy * dy);
        innerDistances.push(innerTotalDist);
      }

      for (let i = 0; len > i; i++) {
        const pt1 = this.innerShape[i]!;
        const pt2 = this.innerShape[(i + 1) % len]!;

        v.push(pt1.x, pt1.y, hh); // 0: front-left
        v.push(pt2.x, pt2.y, hh); // 1: front-right
        v.push(pt1.x, pt1.y, -hh); // 2: back-left
        v.push(pt2.x, pt2.y, -hh); // 3: back-right

        const u1 = innerTotalDist > 0 ? innerDistances[i]! / innerTotalDist : 0;
        const u2 = innerTotalDist > 0 ? innerDistances[i + 1]! / innerTotalDist : 0;

        uv.push(u1, 1);
        uv.push(u2, 1);
        uv.push(u1, 0);
        uv.push(u2, 0);

        // Winding for inner hole must be reversed: 0->1->2 and 1->3->2
        idx.push(sideVOffset + 0, sideVOffset + 1, sideVOffset + 2);
        idx.push(sideVOffset + 1, sideVOffset + 3, sideVOffset + 2);

        wireframeLines.push(sideVOffset + 0, sideVOffset + 2); // inner vertical edge

        sideVOffset += 4;
      }
    }

    this._vertices = new Float32Array(v);
    this._uvs = new Float32Array(uv);
    this._indices = this._createIndexArray(idx.length);
    this._indices.set(idx);

    this._wireframeIndices = this._createIndexArray(wireframeLines.length);
    this._wireframeIndices.set(wireframeLines);

    this.computeNormals();
  }
}
