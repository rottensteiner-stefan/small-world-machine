import type { ShaderLayout } from "./ShaderDefinition.js";
import { ShaderPropertyType } from "../../enums/index.js";
import { Vector3D, Matrix4 } from "../../math/index.js";
import { Color } from "../../core/colors/index.js";

/**
 * Utility to pack uniform data into a Float32Array based on a layout.
 */
export class UniformPacker {
  /**
   * Packs properties into a pre-allocated buffer.
   * @param layout The shader layout defining the sequence.
   * @param values The actual values to pack.
   * @param data The Float32Array to write into.
   * @returns The same Float32Array for chaining.
   */
  public static packInto(
    layout: ShaderLayout,
    values: Record<string, unknown>,
    data: Float32Array,
  ): Float32Array {
    data.fill(0);
    if (!layout.uniformLayout) {
      console.error(
        `[UniformPacker] Material layout is missing 'uniformLayout'. This will result in empty data being sent to the GPU!`,
      );
      return data;
    }

    let offset = 0; // in floats (4 bytes each)

    for (const name of layout.uniformLayout) {
      const meta = layout.uniforms[name];
      if (!meta) {
        console.warn(
          `[UniformPacker] Property '${name}' listed in layout but not defined in uniforms.`,
        );
        continue;
      }

      const val = values[name] ?? meta.defaultValue;

      // Ensure Alignment
      const alignment = this._getTypeAlignment(meta.type);
      if (offset % alignment !== 0) {
        offset += alignment - (offset % alignment);
      }

      if (val === undefined) {
        console.warn(`[UniformPacker] Property '${name}' has no value and no default.`);
        offset += this._getTypeSize(meta.type);
        continue;
      }

      switch (meta.type) {
        case ShaderPropertyType.FLOAT:
          data[offset] = val as number;
          offset += 1;
          break;
        case ShaderPropertyType.VEC2:
          if (Array.isArray(val) || val instanceof Float32Array) {
            data[offset] = (val as number[])[0]!;
            data[offset + 1] = (val as number[])[1]!;
          }
          offset += 2;
          break;
        case ShaderPropertyType.VEC3:
          if (val instanceof Vector3D) {
            data[offset] = val.x;
            data[offset + 1] = val.y;
            data[offset + 2] = val.z;
          } else if (Array.isArray(val) || val instanceof Float32Array) {
            data[offset] = (val as number[])[0]!;
            data[offset + 1] = (val as number[])[1]!;
            data[offset + 2] = (val as number[])[2]!;
          }
          offset += 3;
          break;
        case ShaderPropertyType.VEC4:
        case ShaderPropertyType.COLOR:
          if (val instanceof Color) {
            data.set(val.toFloat32Array(), offset);
          } else if (Array.isArray(val) || val instanceof Float32Array) {
            data.set(val as Float32Array, offset);
          }
          offset += 4;
          break;
        case ShaderPropertyType.MAT4:
          if (val instanceof Matrix4) {
            data.set(val.data, offset);
          } else if (val instanceof Float32Array) {
            data.set(val, offset);
          }
          offset += 16;
          break;
      }
    }

    return data;
  }

  private static _getTypeSize(type: ShaderPropertyType): number {
    switch (type) {
      case ShaderPropertyType.FLOAT:
        return 1;
      case ShaderPropertyType.VEC2:
        return 2;
      case ShaderPropertyType.VEC3:
        return 3;
      case ShaderPropertyType.VEC4:
        return 4;
      case ShaderPropertyType.COLOR:
        return 4;
      case ShaderPropertyType.MAT4:
        return 16;
      default:
        return 0;
    }
  }

  private static _getTypeAlignment(type: ShaderPropertyType): number {
    switch (type) {
      case ShaderPropertyType.FLOAT:
        return 1;
      case ShaderPropertyType.VEC2:
        return 2;
      case ShaderPropertyType.VEC3:
        return 4; // 16 bytes alignment for vec3
      case ShaderPropertyType.VEC4:
        return 4; // 16 bytes
      case ShaderPropertyType.COLOR:
        return 4; // 16 bytes
      case ShaderPropertyType.MAT4:
        // A mat4x4's base alignment is that of its column type (vec4 -> 16 bytes / 4 floats),
        // NOT its total size (64 bytes) -- WGSL/std140 §alignment: "If S is a matrix type, then
        // A = AlignOf(the vector type of the same element type and R rows)". Occupying the full
        // 64 bytes is `_getTypeSize`'s job; aligning to a 64-byte boundary here would only ever
        // coincidentally match the spec when a MAT4 happens to already sit at offset 0 (true of
        // every layout in this codebase today) -- any layout with a MAT4 preceded by an offset
        // that's a multiple of 4 floats but not 16 would otherwise insert bytes of padding the
        // real WGSL struct doesn't have, corrupting every uniform packed after it.
        return 4; // 16 bytes
      default:
        return 1;
    }
  }
}
