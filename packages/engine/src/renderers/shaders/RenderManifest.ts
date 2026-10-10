import { Texture, CubeTexture } from "../../core/textures/index.js";
import { BlendingMode, CullMode, Topology } from "../../enums/index.js";
/**
 * Manifest flag for materials that read per-vertex colors (`a_color`, RGBA, white when the mesh
 * has none). The renderers bind the color stream only for programs/pipelines compiled with it.
 */
export const VERTEX_COLOR_FLAG = "USE_VERTEX_COLOR";

/**
 * The RenderManifest is the "order sheet" that a material
 * passes to the renderer to describe its requirements.
 */
export interface RenderManifest {
  /** The ID of the shader to use. */
  shaderId: string;

  /**
   * The properties (uniforms) for the material.
   * Key: Property name as defined in ShaderDefinition layout.
   */
  properties: Record<string, unknown>;

  /**
   * The textures for the material.
   * Key: Texture name as defined in ShaderDefinition layout.
   */
  textures: Record<string, Texture | CubeTexture | undefined>;

  /** Optional shader flags to compile variants (e.g. USE_TEXTURE_ARRAY) */
  flags?: string[];

  /**
   * Optional GPU state overrides for this specific draw call.
   */
  state?: {
    culling?: CullMode;
    blending?: BlendingMode;
    depthWrite?: boolean;
    depthTest?: boolean;
    transparent?: boolean;
    /** Whether this object should be treated as a camera-facing sprite (billboarding). */
    isSprite?: boolean;
    /** The primitive topology (e.g., TRIANGLE_LIST or LINE_LIST). Defaults to TRIANGLE_LIST. */
    topology?: Topology;
    /** The wireframe mode. Defaults to "structural". */
    wireframeMode?: "structural" | "triangles";
    /**
     * Opt-out of the GPU depth pre-pass (see DepthPrePassGPU). Materials whose custom shading the
     * shared depth pipeline cannot faithfully reproduce (custom shaders with world-space vertex
     * deformation) or geometries that must never occlude (wireframes, sprites) set this to `true`
     * so the pre-pass skips them WITHOUT having to maintain a growing list of shaderIds/prefixes
     * in the pass itself. Note this is independent of `depthWrite`/`transparent` -- a material may
     * still legitimately want to write depth in its OWN pass while staying out of the pre-pass.
     */
    skipDepthPrePass?: boolean;
  };
}
