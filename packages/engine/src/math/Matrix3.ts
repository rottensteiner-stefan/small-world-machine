/**
 * A class representing a 3x3 matrix.
 * Used for 2D transformations or normal matrices.
 */
export class Matrix3 {
  /** The matrix data in column-major order. */
  public data: Float32Array = new Float32Array(9);

  /**
   * Creates a new Matrix3 and initializes it to the identity matrix.
   */
  constructor() {
    this.identity();
  }

  /**
   * Sets the matrix to the identity matrix.
   * @returns this
   */
  public identity(): this {
    const d = this.data;
    d[0] = 1;
    d[3] = 0;
    d[6] = 0;
    d[1] = 0;
    d[4] = 1;
    d[7] = 0;
    d[2] = 0;
    d[5] = 0;
    d[8] = 1;
    return this;
  }

  /**
   * Sets the matrix from the upper-left 3x3 part of a 4x4 matrix.
   * @param m The source 4x4 matrix.
   * @returns this
   */
  public setFromMatrix4(m: { data: Float32Array }): this {
    const me = m.data;
    const d = this.data;

    d[0] = me[0]!;
    d[3] = me[4]!;
    d[6] = me[8]!;
    d[1] = me[1]!;
    d[4] = me[5]!;
    d[7] = me[9]!;
    d[2] = me[2]!;
    d[5] = me[6]!;
    d[8] = me[10]!;

    return this;
  }

  /**
   * Calculates the normal matrix (transpose of the inverse of the upper-left 3x3 of a 4x4 matrix).
   * Used for transforming normals correctly when non-uniform scaling is present.
   * @param m The source 4x4 matrix.
   * @returns this
   */
  public getNormalMatrix(m: { data: Float32Array }): this {
    const me: Float32Array = m.data;
    const te: Float32Array = this.data;

    const n11: number = me[0]!,
      n12: number = me[4]!,
      n13: number = me[8]!;
    const n21: number = me[1]!,
      n22: number = me[5]!,
      n23: number = me[9]!;
    const n31: number = me[2]!,
      n32: number = me[6]!,
      n33: number = me[10]!;

    const t11: number = n33 * n22 - n32 * n23;
    const t12: number = n32 * n13 - n33 * n12;
    const t13: number = n23 * n12 - n22 * n13;

    const det: number = n11 * t11 + n21 * t12 + n31 * t13;

    if (0 === det) {
      return this.identity();
    }

    const detInv: number = 1.0 / det;

    // Column 0: C11, C21, C31
    te[0] = t11 * detInv;
    te[1] = t12 * detInv;
    te[2] = t13 * detInv;

    // Column 1: C12, C22, C32
    te[3] = (n31 * n23 - n33 * n21) * detInv;
    te[4] = (n33 * n11 - n31 * n13) * detInv;
    te[5] = (n21 * n13 - n23 * n11) * detInv;

    // Column 2: C13, C23, C33
    te[6] = (n32 * n21 - n31 * n22) * detInv;
    te[7] = (n31 * n12 - n32 * n11) * detInv;
    te[8] = (n22 * n11 - n21 * n12) * detInv;

    return this;
  }

  /**
   * Multiplies two 3x3 matrices and stores the result in out.
   * @param a The first matrix.
   * @param b The second matrix.
   * @param out The output matrix.
   */
  public static multiply(a: Matrix3, b: Matrix3, out: Matrix3): void {
    const ae: Float32Array = a.data;
    const be: Float32Array = b.data;
    const te: Float32Array = out.data;

    const a11: number = ae[0]!,
      a12: number = ae[3]!,
      a13: number = ae[6]!;
    const a21: number = ae[1]!,
      a22: number = ae[4]!,
      a23: number = ae[7]!;
    const a31: number = ae[2]!,
      a32: number = ae[5]!,
      a33: number = ae[8]!;

    const b11: number = be[0]!,
      b12: number = be[3]!,
      b13: number = be[6]!;
    const b21: number = be[1]!,
      b22: number = be[4]!,
      b23: number = be[7]!;
    const b31: number = be[2]!,
      b32: number = be[5]!,
      b33: number = be[8]!;

    te[0] = a11 * b11 + a12 * b21 + a13 * b31;
    te[3] = a11 * b12 + a12 * b22 + a13 * b32;
    te[6] = a11 * b13 + a12 * b23 + a13 * b33;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31;
    te[4] = a21 * b12 + a22 * b22 + a23 * b32;
    te[7] = a21 * b13 + a22 * b23 + a23 * b33;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31;
    te[5] = a31 * b12 + a32 * b22 + a33 * b32;
    te[8] = a31 * b13 + a32 * b23 + a33 * b33;
  }

  /**
   * Transforms a Vector3D by this 3x3 matrix (result = M * v).
   * @param v The vector to transform.
   * @param result Optional target vector (defaults to v).
   * @returns The transformed vector.
   */
  public transformVector(
    v: { x: number; y: number; z: number },
    result: { x: number; y: number; z: number } = v,
  ): typeof result {
    const x = v.x,
      y = v.y,
      z = v.z;
    const e = this.data;
    result.x = e[0]! * x + e[3]! * y + e[6]! * z;
    result.y = e[1]! * x + e[4]! * y + e[7]! * z;
    result.z = e[2]! * x + e[5]! * y + e[8]! * z;
    return result;
  }
}
