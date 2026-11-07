import type { Vector3D } from "./Vector3D.js";
import { MathPool } from "./MathPool.js";

/**
 * A 4x4 matrix class for 3D transformations (Column-Major).
 */
export class Matrix4 {
  public data: Float32Array = new Float32Array(16);

  constructor() {
    this.identity();
  }

  public identity(): Matrix4 {
    this.data.fill(0);
    this.data[0] = 1;
    this.data[5] = 1;
    this.data[10] = 1;
    this.data[15] = 1;
    return this;
  }

  public copy(m: Matrix4): this {
    this.data.set(m.data);
    return this;
  }

  public multiply(m: Matrix4): this {
    Matrix4.multiply(this, m, this);
    return this;
  }

  public invert(target: Matrix4 = this): boolean {
    return Matrix4.invert(this, target);
  }

  public transpose(): this {
    const te = this.data;
    let tmp: number;
    tmp = te[1]!;
    te[1] = te[4]!;
    te[4] = tmp;
    tmp = te[2]!;
    te[2] = te[8]!;
    te[8] = tmp;
    tmp = te[6]!;
    te[6] = te[9]!;
    te[9] = tmp;
    tmp = te[3]!;
    te[3] = te[12]!;
    te[12] = tmp;
    tmp = te[7]!;
    te[7] = te[13]!;
    te[13] = tmp;
    tmp = te[11]!;
    te[11] = te[14]!;
    te[14] = tmp;
    return this;
  }

  public transformVector(v: Vector3D, result: Vector3D = v): Vector3D {
    const x = v.x,
      y = v.y,
      z = v.z;
    const e = this.data;
    const e0 = e[0]!,
      e1 = e[1]!,
      e2 = e[2]!,
      e3 = e[3]!;
    const e4 = e[4]!,
      e5 = e[5]!,
      e6 = e[6]!,
      e7 = e[7]!;
    const e8 = e[8]!,
      e9 = e[9]!,
      e10 = e[10]!,
      e11 = e[11]!;
    const e12 = e[12]!,
      e13 = e[13]!,
      e14 = e[14]!,
      e15 = e[15]!;
    const w = 1 / (e3 * x + e7 * y + e11 * z + e15);
    result.x = (e0 * x + e4 * y + e8 * z + e12) * w;
    result.y = (e1 * x + e5 * y + e9 * z + e13) * w;
    result.z = (e2 * x + e6 * y + e10 * z + e14) * w;
    return result;
  }

  /**
   * Composes matrix from pos, rot (Euler YXZ), scale.
   */
  public compose(pos: Vector3D, rot: Vector3D, scale: Vector3D): this {
    const te = this.data;
    const x = rot.x,
      y = rot.y,
      z = rot.z;
    const cX = Math.cos(x),
      sX = Math.sin(x);
    const cY = Math.cos(y),
      sY = Math.sin(y);
    const cZ = Math.cos(z),
      sZ = Math.sin(z);

    const scX = scale.x,
      scY = scale.y,
      scZ = scale.z;

    te[0] = (cY * cZ + sY * sX * sZ) * scX;
    te[1] = cX * sZ * scX;
    te[2] = (-sY * cZ + cY * sX * sZ) * scX;
    te[3] = 0;

    te[4] = (-cY * sZ + sY * sX * cZ) * scY;
    te[5] = cX * cZ * scY;
    te[6] = (sY * sZ + cY * sX * cZ) * scY;
    te[7] = 0;

    te[8] = sY * cX * scZ;
    te[9] = -sX * scZ;
    te[10] = cY * cX * scZ;
    te[11] = 0;

    te[12] = pos.x;
    te[13] = pos.y;
    te[14] = pos.z;
    te[15] = 1;

    return this;
  }

  /**
   * Composes matrix from pos, quaternion rotation, scale.
   */
  public composeFromQuaternion(
    pos: Vector3D,
    q: { x: number; y: number; z: number; w: number },
    scale: Vector3D,
  ): this {
    const te = this.data;
    const x = q.x,
      y = q.y,
      z = q.z,
      w = q.w;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2;
    const yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2;

    const sx = scale.x,
      sy = scale.y,
      sz = scale.z;

    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;

    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;

    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;

    te[12] = pos.x;
    te[13] = pos.y;
    te[14] = pos.z;
    te[15] = 1;

    return this;
  }

  public setFromQuaternion(q: { x: number; y: number; z: number; w: number }): this {
    const te = this.data;
    const x = q.x,
      y = q.y,
      z = q.z,
      w = q.w;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2;
    const yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2;

    te[0] = 1 - (yy + zz);
    te[4] = xy - wz;
    te[8] = xz + wy;
    te[12] = 0;

    te[1] = xy + wz;
    te[5] = 1 - (xx + zz);
    te[9] = yz - wx;
    te[13] = 0;

    te[2] = xz - wy;
    te[6] = yz + wx;
    te[10] = 1 - (xx + yy);
    te[14] = 0;

    te[3] = 0;
    te[7] = 0;
    te[11] = 0;
    te[15] = 1;
    return this;
  }

  public decompose(position: Vector3D, rotation: Vector3D, scale: Vector3D): this {
    const te = this.data;
    position.set(te[12]!, te[13]!, te[14]!);

    const te0 = te[0]!,
      te1 = te[1]!,
      te2 = te[2]!;
    const te4 = te[4]!,
      te5 = te[5]!,
      te6 = te[6]!;
    const te8 = te[8]!,
      te9 = te[9]!,
      te10 = te[10]!;

    let sx = Math.hypot(te0, te1, te2);
    const sy = Math.hypot(te4, te5, te6);
    const sz = Math.hypot(te8, te9, te10);

    if (this.determinant() < 0) sx = -sx;
    scale.set(sx, sy, sz);

    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;

    const r0 = te0 * invSX;
    const r1 = te1 * invSX;
    const r2 = te2 * invSX;

    const r5 = te5 * invSY;

    const r8 = te8 * invSZ;
    const r9 = te9 * invSZ;
    const r10 = te10 * invSZ;

    rotation.x = Math.asin(-Math.max(-1, Math.min(1, r9)));
    if (Math.abs(r9) < 0.99999) {
      rotation.y = Math.atan2(r8, r10);
      rotation.z = Math.atan2(r1, r5);
    } else {
      rotation.y = Math.atan2(-r2, r0);
      rotation.z = 0;
    }

    return this;
  }

  public determinant(): number {
    const te = this.data;
    const n11 = te[0]!,
      n12 = te[4]!,
      n13 = te[8]!,
      n14 = te[12]!;
    const n21 = te[1]!,
      n22 = te[5]!,
      n23 = te[9]!,
      n24 = te[13]!;
    const n31 = te[2]!,
      n32 = te[6]!,
      n33 = te[10]!,
      n34 = te[14]!;
    const n41 = te[3]!,
      n42 = te[7]!,
      n43 = te[11]!,
      n44 = te[15]!;
    return (
      n41 *
        (+n14 * n23 * n32 -
          n13 * n24 * n32 -
          n14 * n22 * n33 +
          n12 * n24 * n33 +
          n13 * n22 * n34 -
          n12 * n23 * n34) +
      n42 *
        (+n11 * n23 * n34 -
          n11 * n24 * n33 +
          n14 * n21 * n33 -
          n13 * n21 * n34 +
          n13 * n24 * n31 -
          n14 * n23 * n31) +
      n43 *
        (+n11 * n24 * n32 -
          n11 * n22 * n34 -
          n14 * n21 * n32 +
          n12 * n21 * n34 +
          n14 * n22 * n31 -
          n12 * n24 * n31) +
      n44 *
        (-n13 * n22 * n31 -
          n11 * n23 * n32 +
          n11 * n22 * n33 +
          n13 * n21 * n32 -
          n12 * n21 * n33 +
          n12 * n23 * n31)
    );
  }

  public static multiply(a: Matrix4, b: Matrix4, result: Matrix4): void {
    const ae = a.data;
    const be = b.data;
    const te = result.data;

    const a11 = ae[0]!,
      a12 = ae[4]!,
      a13 = ae[8]!,
      a14 = ae[12]!;
    const a21 = ae[1]!,
      a22 = ae[5]!,
      a23 = ae[9]!,
      a24 = ae[13]!;
    const a31 = ae[2]!,
      a32 = ae[6]!,
      a33 = ae[10]!,
      a34 = ae[14]!;
    const a41 = ae[3]!,
      a42 = ae[7]!,
      a43 = ae[11]!,
      a44 = ae[15]!;

    const b11 = be[0]!,
      b12 = be[4]!,
      b13 = be[8]!,
      b14 = be[12]!;
    const b21 = be[1]!,
      b22 = be[5]!,
      b23 = be[9]!,
      b24 = be[13]!;
    const b31 = be[2]!,
      b32 = be[6]!,
      b33 = be[10]!,
      b34 = be[14]!;
    const b41 = be[3]!,
      b42 = be[7]!,
      b43 = be[11]!,
      b44 = be[15]!;

    const r11 = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    const r12 = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    const r13 = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    const r14 = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

    const r21 = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    const r22 = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    const r23 = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    const r24 = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

    const r31 = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    const r32 = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    const r33 = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    const r34 = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

    const r41 = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    const r42 = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    const r43 = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    const r44 = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    te[0] = r11;
    te[4] = r12;
    te[8] = r13;
    te[12] = r14;
    te[1] = r21;
    te[5] = r22;
    te[9] = r23;
    te[13] = r24;
    te[2] = r31;
    te[6] = r32;
    te[10] = r33;
    te[14] = r34;
    te[3] = r41;
    te[7] = r42;
    te[11] = r43;
    te[15] = r44;
  }

  public static perspective(
    fov: number,
    aspect: number,
    near: number,
    far: number,
    target: Matrix4,
  ): void {
    const f = 1.0 / Math.tan(fov / 2);
    const rangeInv = 1.0 / (near - far);
    target.data.fill(0);
    target.data[0] = f / aspect;
    target.data[5] = f;
    target.data[10] = (far + near) * rangeInv;
    target.data[11] = -1;
    target.data[14] = 2 * far * near * rangeInv;
  }

  public static orthographic(
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number,
    target: Matrix4,
  ): void {
    const w = 1.0 / (right - left);
    const h = 1.0 / (top - bottom);
    const p = 1.0 / (far - near);
    target.data.fill(0);
    target.data[0] = 2 * w;
    target.data[5] = 2 * h;
    target.data[10] = -2 * p;
    target.data[12] = -(right + left) * w;
    target.data[13] = -(top + bottom) * h;
    target.data[14] = -(far + near) * p;
    target.data[15] = 1;
  }

  public static lookAt(eye: Vector3D, target: Vector3D, up: Vector3D, result: Matrix4): void {
    const z = MathPool.acquireVector().copyFrom(eye).sub(target).normalize();
    if (z.lengthSq() === 0) z.z = 1;

    const x = MathPool.acquireVector().copyFrom(up).cross(z).normalize();
    if (x.lengthSq() === 0) {
      if (Math.abs(up.z) < 0.999) {
        z.z += 0.0001;
      } else {
        z.x += 0.0001;
      }
      z.normalize();
      x.copyFrom(up).cross(z).normalize();
    }
    const y = MathPool.acquireVector().copyFrom(z).cross(x).normalize();

    const te = result.data;
    te[0] = x.x;
    te[4] = x.y;
    te[8] = x.z;
    te[12] = -x.dot(eye);
    te[1] = y.x;
    te[5] = y.y;
    te[9] = y.z;
    te[13] = -y.dot(eye);
    te[2] = z.x;
    te[6] = z.y;
    te[10] = z.z;
    te[14] = -z.dot(eye);
    te[3] = 0;
    te[7] = 0;
    te[11] = 0;
    te[15] = 1;

    MathPool.releaseVector(x);
    MathPool.releaseVector(y);
    MathPool.releaseVector(z);
  }

  public static invert(src: Matrix4, target: Matrix4): boolean {
    const te = target.data;
    const n = src.data;

    const a0 = n[0]!,
      a1 = n[1]!,
      a2 = n[2]!,
      a3 = n[3]!;
    const b0 = n[4]!,
      b1 = n[5]!,
      b2 = n[6]!,
      b3 = n[7]!;
    const c0 = n[8]!,
      c1 = n[9]!,
      c2 = n[10]!,
      c3 = n[11]!;
    const d0 = n[12]!,
      d1 = n[13]!,
      d2 = n[14]!,
      d3 = n[15]!;

    const b01 = a0 * b1 - a1 * b0;
    const b02 = a0 * b2 - a2 * b0;
    const b03 = a0 * b3 - a3 * b0;
    const b12 = a1 * b2 - a2 * b1;
    const b13 = a1 * b3 - a3 * b1;
    const b23 = a2 * b3 - a3 * b2;
    const c01 = c0 * d1 - c1 * d0;
    const c02 = c0 * d2 - c2 * d0;
    const c03 = c0 * d3 - c3 * d0;
    const c12 = c1 * d2 - c2 * d1;
    const c13 = c1 * d3 - c3 * d1;
    const c23 = c2 * d3 - c3 * d2;

    const det = b01 * c23 - b02 * c13 + b03 * c12 + b12 * c03 - b13 * c02 + b23 * c01;

    if (det === 0) return false;
    const invDet = 1 / det;

    te[0] = (b1 * c23 - b2 * c13 + b3 * c12) * invDet;
    te[1] = (-a1 * c23 + a2 * c13 - a3 * c12) * invDet;
    te[2] = (d1 * b23 - d2 * b13 + d3 * b12) * invDet;
    te[3] = (-c1 * b23 + c2 * b13 - c3 * b12) * invDet;
    te[4] = (-b0 * c23 + b2 * c03 - b3 * c02) * invDet;
    te[5] = (a0 * c23 - a2 * c03 + a3 * c02) * invDet;
    te[6] = (-d0 * b23 + d2 * b03 - d3 * b02) * invDet;
    te[7] = (c0 * b23 - c2 * b03 + c3 * b02) * invDet;
    te[8] = (b0 * c13 - b1 * c03 + b3 * c01) * invDet;
    te[9] = (-a0 * c13 + a1 * c03 - a3 * c01) * invDet;
    te[10] = (d0 * b13 - d1 * b03 + d3 * b01) * invDet;
    te[11] = (-c0 * b13 + c1 * b03 - c3 * b01) * invDet;
    te[12] = (-b0 * c12 + b1 * c02 - b2 * c01) * invDet;
    te[13] = (a0 * c12 - a1 * c02 + a2 * c01) * invDet;
    te[14] = (-d0 * b12 + d1 * b02 - d2 * b01) * invDet;
    te[15] = (c0 * b12 - c1 * b02 + c2 * b01) * invDet;

    return true;
  }

  public static rotateX(angle: number, target: Matrix4): void {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    target.identity();
    target.data[5] = c;
    target.data[6] = s;
    target.data[9] = -s;
    target.data[10] = c;
  }
  public static rotateY(angle: number, target: Matrix4): void {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    target.identity();
    target.data[0] = c;
    target.data[2] = -s;
    target.data[8] = s;
    target.data[10] = c;
  }
  public static rotateZ(angle: number, target: Matrix4): void {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    target.identity();
    target.data[0] = c;
    target.data[1] = s;
    target.data[4] = -s;
    target.data[5] = c;
  }
  public static translate(x: number, y: number, z: number, target: Matrix4): void {
    target.identity();
    target.data[12] = x;
    target.data[13] = y;
    target.data[14] = z;
  }
  /**
   * Sets the target matrix to a uniform scale matrix (or creates a new Matrix4).
   * @param s The uniform scale factor.
   * @param target Optional target matrix to write into.
   */
  public static scale(s: number, target?: Matrix4): Matrix4;
  /**
   * Sets the target matrix to a non-uniform scale matrix (or creates a new Matrix4).
   * @param x Scale along X axis.
   * @param y Scale along Y axis.
   * @param z Scale along Z axis.
   * @param target Optional target matrix to write into.
   */
  public static scale(x: number, y: number, z: number, target?: Matrix4): Matrix4;
  /**
   * Implementation for uniform or non-uniform scale matrix creation/mutation.
   */
  public static scale(
    x: number,
    yOrTarget?: number | Matrix4,
    z?: number,
    target?: Matrix4,
  ): Matrix4 {
    let out: Matrix4;
    let sx: number;
    let sy: number;
    let sz: number;

    if (yOrTarget instanceof Matrix4) {
      out = yOrTarget;
      sx = x;
      sy = x;
      sz = x;
    } else if (typeof yOrTarget === "number") {
      sx = x;
      sy = yOrTarget;
      sz = typeof z === "number" ? z : 1;
      out = target ?? new Matrix4();
    } else {
      out = new Matrix4();
      sx = x;
      sy = x;
      sz = x;
    }

    out.identity();
    out.data[0] = sx;
    out.data[5] = sy;
    out.data[10] = sz;
    return out;
  }

  public static readonly ZO_CORRECTION: Matrix4 = ((): Matrix4 => {
    const m = new Matrix4();
    m.data.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 1]);
    return m;
  })();
}
