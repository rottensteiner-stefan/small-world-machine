import fragGLSL from "./Smoke.frag.glsl?raw";
import fragGLSL100 from "./Smoke.frag.glsl100?raw";
import fragWGSL from "./Smoke.frag.wgsl?raw";
import type { RenderManifest, ShaderDefinition } from "@small-world-machine/engine";
import {
  AbstractMaterial,
  BlendingMode,
  CullMode,
  StandardWebGPULayout,
} from "@small-world-machine/engine";

/**
 * Configuration options for {@link SmokeSpriteMaterial}.
 */
export interface SmokeSpriteMaterialOptions {
  /** Animation time in seconds; advances the edge churn. Defaults to 0. */
  time?: number;
  /** Churn strength (>=0); 0 = perfectly smooth billboard. Defaults to 1. */
  churn?: number;
}

/**
 * Alpha-blended soft smoke billboard for `FireSmokeEmitter`. Purely procedural (no texture): a soft
 * radial blob, roughened by a scrolling value-noise edge that grows harsher as the particle fades —
 * a dissolving plume, never a hard-edged quad. The per-instance buffer is read directly in the
 * fragment: rgb = smoke tint (authored warm-lit → cold dark by the particle pipeline), a = opacity.
 * Because alpha is opacity here, the paired renderer must run with `foldAlphaIntoScale = false`.
 */
export class SmokeSpriteMaterial extends AbstractMaterial {
  public static readonly TYPE = "SmokeSpriteMaterial";

  /** @domain animation time in seconds, advanced by the owner every frame; pause freezes the plume. */
  public time: number;
  /** @domain churn strength (>=0); 0 = perfectly smooth puff. */
  public churn: number;

  constructor(options: SmokeSpriteMaterialOptions = {}) {
    super(SmokeSpriteMaterial.TYPE);
    this.time = options.time ?? 0;
    this.churn = options.churn ?? 1;

    this.transparent = true;
    this.depthWrite = false;
    this.cullMode = CullMode.NONE;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_matParam0"] = [0, 0, 0, 0];
      const state = this._renderManifest.state!;
      // Straight-alpha smoke: the fragment alpha fades the quad out of existence.
      state.blending = BlendingMode.ALPHA;
      // CPU-side billboarding (ParticleMeshRenderer) cannot be reproduced by the shared depth
      // pre-pass pipeline — same exclusion as the flame and the ember sprites.
      state.skipDepthPrePass = true;
    }
    this._syncBaseManifestState();

    const props = this._renderManifest.properties;
    const p0 = props["u_matParam0"] as number[];
    p0[0] = this.time;
    p0[1] = this.churn;

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: SmokeSpriteMaterial.TYPE,
      sources: {
        glsl300: { vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]", fs: fragGLSL },
        glsl100: { vs: "[BASE_VS]", fs: fragGLSL100 },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: StandardWebGPULayout,
    };
  }
}
