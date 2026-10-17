import type { Vector } from "../interfaces/index.js";

/**
 * A class representing a 2D vector.
 * Data is stored as individual properties for fast access in JS engines.
 */
export class Vector2D implements Vector {
  /**
   * Creates a new Vector2D.
   * @param x The x component. Defaults to 0.
   * @param y The y component. Defaults to 0.
   */
  constructor(
    public x: number = 0,
    public y: number = 0,
  ) {}

  /**
   * Sets the components of the vector.
   * @param x The x component.
   * @param y The y component.
   * @returns this
   */
  public set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  /**
   * Adds another vector to this one.
   * @param v The vector to add.
   * @returns this
   */
  public add(v: Vector2D): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /**
   * Adds a scalar to this vector.
   * @param s The scalar to add.
   * @returns this
   */
  public addScalar(s: number): this {
    this.x += s;
    this.y += s;
    return this;
  }

  /**
   * Multiplies this vector by another (component-wise).
   * @param v The other vector.
   * @returns this
   */
  public multiply(v: Vector2D): this {
    this.x *= v.x;
    this.y *= v.y;
    return this;
  }

  /**
   * Divides this vector by a scalar.
   * @param s The scalar to divide by.
   * @returns this
   */
  public divideScalar(s: number): this {
    if (0 !== s) {
      const invLen = 1.0 / s;
      this.x *= invLen;
      this.y *= invLen;
    } else {
      this.x = 0;
      this.y = 0;
    }
    return this;
  }

  /**
   * Subtracts another vector from this one.
   * @param v The vector to subtract.
   * @returns this
   */
  public sub(v: Vector2D): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /**
   * Scales the vector by a scalar value.
   * @param s The scalar factor.
   * @returns this
   */
  public scale(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  /**
   * Calculates the dot product of this vector and another.
   * @param v The other vector.
   * @returns The dot product.
   */
  public dot(v: Vector2D): number {
    return this.x * v.x + this.y * v.y;
  }

  /**
   * Calculates the squared length of the vector.
   * @returns The squared length.
   */
  public lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  /**
   * Calculates the Euclidean length of the vector.
   * @returns The length.
   */
  public length(): number {
    return Math.sqrt(this.lengthSq());
  }

  /**
   * Calculates the squared distance to another vector.
   * @param v The other vector.
   * @returns The squared distance.
   */
  public distanceToSq(v: Vector2D): number {
    const dx: number = this.x - v.x;
    const dy: number = this.y - v.y;
    return dx * dx + dy * dy;
  }

  /**
   * Calculates the Euclidean distance to another vector.
   * @param v The other vector.
   * @returns The distance.
   */
  public distanceTo(v: Vector2D): number {
    return Math.sqrt(this.distanceToSq(v));
  }

  /**
   * Clones the vector into a new instance.
   * @returns A new Vector2D.
   */
  public clone(): Vector2D {
    return new Vector2D(this.x, this.y);
  }

  /**
   * Normalizes the vector to a unit length of 1.
   * @returns this
   */
  public normalize(): this {
    const len: number = this.length();

    if (0.000001 < len) {
      const invLen: number = 1.0 / len;
      this.x *= invLen;
      this.y *= invLen;
    } else {
      this.x = 0;
      this.y = 0;
    }

    return this;
  }
}
