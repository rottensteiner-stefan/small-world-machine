import type { ShaderImporter } from "./ShaderImporter.js";
import type { CustomShaderMaterialOptions } from "../CustomShaderMaterial.js";
import { ShaderPropertyType } from "../../../enums/index.js";

/**
 * Importer for Compute.toys (WGSL).
 * Compute.toys uses WebGPU compute shaders. Since SmallWorldMachine's CustomShaderMaterial
 * operates in the fragment pipeline, this importer uses heuristics to translate
 * `textureStore(screen, ...)` into fragment outputs, and provides the `custom` uniform struct.
 */
export class ComputeToysImporter implements ShaderImporter {
  public parse(sourceCode: string): CustomShaderMaterialOptions {
    // Basic heuristic: Replace compute signature with a fragment-friendly signature
    let adaptedCode = sourceCode;

    // Remove the compute attributes
    adaptedCode = adaptedCode.replace(/@compute\s*@workgroup_size\([^)]+\)/g, "");

    // Replace textureStore with returning the color
    // e.g. textureStore(screen, id.xy, vec4<f32>(col_linear, 1.)); -> return vec4<f32>(col_linear, 1.);
    adaptedCode = adaptedCode.replace(
      /textureStore\s*\(\s*screen\s*,\s*[^,]+,\s*(.*)\s*\)\s*;/g,
      "return $1;",
    );

    // Replace the main function signature
    adaptedCode = adaptedCode.replace(
      /fn\s+main_image\s*\(\s*@builtin\(global_invocation_id\)\s+id\s*:\s*vec3<u32>\s*\)/g,
      "fn compute_toys_main(id: vec3<u32>) -> vec4f",
    );

    const wgslSource = `
struct ComputeToysCustom {
  time: f32,
  resolution: vec2f,
  mouse: vec4f,
}

var<private> custom: ComputeToysCustom;

fn init_custom() {
    custom.time = obj.time;
    custom.resolution = obj.extraParams.xy;
    custom.mouse = obj.liquidParams;
}

${adaptedCode}

@vertex
fn vs(
  @location(0) a_position: vec3f, 
  @location(1) a_normal: vec3f, 
  @location(2) a_uv: vec2f, 
  @location(3) a_tangent: vec4f
) -> Out {
    var o: Out;
    let worldPos = obj.model * vec4f(a_position, 1.0);
    o.pos = global.vp * worldPos;
    o.wp = worldPos.xyz;
    o.n = a_normal;
    o.uv = a_uv;
    o.t = a_tangent.xyz;
    // Bitangent handedness w = ±1 (vec4 tangent contract, shares location 3 with base.vert).
    let tangentSign = select(a_tangent.w, 1.0, dot(a_tangent.xyz, a_tangent.xyz) < 0.0001);
    o.b = cross(a_normal, a_tangent.xyz) * tangentSign;
    o.original_uv = a_uv;
    o.texIndex = 0.0;
    return o;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
    init_custom();
    // Compute.toys expects id to be pixel coordinates from 0 to resolution
    // We map the billboard's UVs to this resolution to keep it local to the geometry
    let clampedUV = clamp(in.uv, vec2f(0.0), vec2f(1.0));
    let id_x = u32(clampedUV.x * custom.resolution.x);
    let id_y = u32(clampedUV.y * custom.resolution.y); // UV.y is 0 at bottom, 1 at top in Small World Machine Plane
    let id = vec3<u32>(id_x, id_y, 0u);
    // compute.toys writes LINEAR colour to \`screen\` (its blit encodes to sRGB): encode it the way
    // the forward pass does for the active gamma lane (ADR 0049).
    let c = compute_toys_main(id);
    return vec4f(pow(max(c.rgb, vec3f(0.0)), vec3f(1.0 / global.gamma)), c.a);
}
`;

    return {
      sources: {
        wgsl: `[WGSL_STRUCTS]\n${wgslSource}`,
      },
      layout: {
        uniforms: {
          u_model: { type: ShaderPropertyType.MAT4 },
          u_color: { type: ShaderPropertyType.COLOR },
          u_specColor: { type: ShaderPropertyType.COLOR },
          u_texOffset: { type: ShaderPropertyType.VEC2 },
          u_texRepeat: { type: ShaderPropertyType.VEC2 },
          u_shininess: { type: ShaderPropertyType.FLOAT },
          u_isTerrain: { type: ShaderPropertyType.FLOAT },
          u_metallic: { type: ShaderPropertyType.FLOAT },
          u_roughness: { type: ShaderPropertyType.FLOAT },
          resolution: { type: ShaderPropertyType.VEC4 }, // Replaces u_extraParams
          mouse: { type: ShaderPropertyType.VEC4 }, // Replaces u_liquidParams
          u_thresholds: { type: ShaderPropertyType.VEC4 },
          u_useEnvMap: { type: ShaderPropertyType.FLOAT, defaultValue: 0 },
          u_useReflectionMap: { type: ShaderPropertyType.FLOAT, defaultValue: 0 },
          u_reflectivity: { type: ShaderPropertyType.FLOAT, defaultValue: 1.0 },
          time: { type: ShaderPropertyType.FLOAT, defaultValue: 0.0 }, // Replaces u_time
        },
        uniformLayout: [
          "u_model",
          "u_color",
          "u_specColor",
          "u_texOffset",
          "u_texRepeat",
          "u_shininess",
          "u_isTerrain",
          "u_metallic",
          "u_roughness",
          "resolution",
          "mouse",
          "u_thresholds",
          "u_useEnvMap",
          "u_useReflectionMap",
          "u_reflectivity",
          "time",
        ],
        textures: {},
      },
      properties: {
        u_model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        u_color: [1, 1, 1, 1],
        u_specColor: [1, 1, 1, 1],
        u_texOffset: [0, 0],
        u_texRepeat: [1, 1],
        u_shininess: 32,
        u_isTerrain: 0,
        u_metallic: 0,
        u_roughness: 1,
        resolution: [800, 600, 0, 0], // extraParams
        mouse: [0, 0, 0, 0], // liquidParams
        u_thresholds: [0, 0, 0, 0],
        u_useEnvMap: 0,
        u_useReflectionMap: 0,
        u_reflectivity: 1,
        time: 0.0, // time
      },
    };
  }
}
