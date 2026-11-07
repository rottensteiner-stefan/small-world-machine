/**
 * Interface representing a mathematical vector with basic operations.
 * Designed to be implemented by Vector2D and Vector3D.
 */
export interface Vector {
  /**
   * Calculates the Euclidean length of the vector.
   * @returns The length.
   */
  length(): number;

  /**
   * Calculates the squared length of the vector (faster than length()).
   * @returns The squared length.
   */
  lengthSq(): number;

  /**
   * Normalizes the vector to a unit length of 1.
   * @returns This vector instance for chaining.
   */
  normalize(): Vector;

  /**
   * Scales the vector components by a scalar value.
   * @param s The scalar factor.
   * @returns This vector instance for chaining.
   */
  scale(s: number): Vector;
}
