import FOG_DEFS from "../../core/materials/shaders/chunks/fog_defs.glsl?raw";
import FOG_CALC from "../../core/materials/shaders/chunks/fog_calc.glsl?raw";
import DIR_SHADOW_GLSL from "../../core/materials/shaders/chunks/dir_shadow.glsl?raw";
import DIR_SHADOW_WEBGL1_GLSL from "../../core/materials/shaders/chunks/dir_shadow_webgl1.glsl?raw";
import DIR_SHADOW_WGSL from "../../core/materials/shaders/chunks/dir_shadow.wgsl?raw";
import LIQUID_GERSTNER_WAVE_GLSL from "../../core/materials/shaders/chunks/liquid_gerstner_wave.glsl?raw";
import LIQUID_GERSTNER_WAVE_WGSL from "../../core/materials/shaders/chunks/liquid_gerstner_wave.wgsl?raw";
import LIQUID_WORLEY_NOISE_GLSL from "../../core/materials/shaders/chunks/liquid_worley_noise.glsl?raw";
import LIQUID_WORLEY_NOISE_WGSL from "../../core/materials/shaders/chunks/liquid_worley_noise.wgsl?raw";
import LIQUID_CAUSTICS_GLSL from "../../core/materials/shaders/chunks/liquid_caustics.glsl?raw";
import LIQUID_CAUSTICS_WGSL from "../../core/materials/shaders/chunks/liquid_caustics.wgsl?raw";
import LIQUID_GLINT_GLSL from "../../core/materials/shaders/chunks/liquid_glint.glsl?raw";
import LIQUID_GLINT_WGSL from "../../core/materials/shaders/chunks/liquid_glint.wgsl?raw";
import LIQUID_EXT_DEFAULT_GLSL from "../../core/materials/shaders/chunks/liquid_ext_default.glsl?raw";
import LIQUID_EXT_DEFAULT_WGSL from "../../core/materials/shaders/chunks/liquid_ext_default.wgsl?raw";
import FILTER_GLITCH_DISTORT_GLSL from "../../core/materials/shaders/chunks/filter_glitch_distort.glsl?raw";
import FILTER_GLITCH_DISTORT_WGSL from "../../core/materials/shaders/chunks/filter_glitch_distort.wgsl?raw";
import FILTER_VHS_DISTORT_GLSL from "../../core/materials/shaders/chunks/filter_vhs_distort.glsl?raw";
import FILTER_VHS_DISTORT_WGSL from "../../core/materials/shaders/chunks/filter_vhs_distort.wgsl?raw";

import filterNightVisionGLSL from "../../core/materials/shaders/chunks/filter_night_vision.glsl?raw";
import filterNoirGLSL from "../../core/materials/shaders/chunks/filter_noir.glsl?raw";
import filterCyberGlitchGLSL from "../../core/materials/shaders/chunks/filter_cyber_glitch.glsl?raw";
import filterVhsTapeGLSL from "../../core/materials/shaders/chunks/filter_vhs_tape.glsl?raw";
import filterUnderworldGLSL from "../../core/materials/shaders/chunks/filter_underworld.glsl?raw";
import filterOldProjectorGLSL from "../../core/materials/shaders/chunks/filter_old_projector.glsl?raw";
import filterThermalVisionGLSL from "../../core/materials/shaders/chunks/filter_thermal_vision.glsl?raw";

import filterNightVisionWGSL from "../../core/materials/shaders/chunks/filter_night_vision.wgsl?raw";
import filterNoirWGSL from "../../core/materials/shaders/chunks/filter_noir.wgsl?raw";
import filterCyberGlitchWGSL from "../../core/materials/shaders/chunks/filter_cyber_glitch.wgsl?raw";
import filterVhsTapeWGSL from "../../core/materials/shaders/chunks/filter_vhs_tape.wgsl?raw";
import filterUnderworldWGSL from "../../core/materials/shaders/chunks/filter_underworld.wgsl?raw";
import filterOldProjectorWGSL from "../../core/materials/shaders/chunks/filter_old_projector.wgsl?raw";
import filterThermalVisionWGSL from "../../core/materials/shaders/chunks/filter_thermal_vision.wgsl?raw";

// --- WebGL 2 ---
import gl2BaseVsHeader from "./source/web_gl2/chunks/base_vertex_header.vert.glsl?raw";
import gl2BaseVsMain from "./source/web_gl2/chunks/base_vertex_main.vert.glsl?raw";
import gl2BaseFsHeader from "./source/web_gl2/chunks/base_fragment_header.frag.glsl?raw";
import gl2LightDefs from "./source/web_gl2/chunks/lights.frag.glsl?raw";
import gl2LightCalc from "./source/web_gl2/chunks/light_calc.frag.glsl?raw";
import gl2PbrMath from "./source/web_gl2/chunks/pbr_math.frag.glsl?raw";
import gl2LightCalcPbr from "./source/web_gl2/chunks/light_calc_pbr.frag.glsl?raw";
import gl2SdfMath from "./source/web_gl2/chunks/sdf_math.glsl?raw";

// --- WebGL 1 ---
import gl1LightDefs from "./source/web_gl1/chunks/lights.frag.glsl?raw";
import gl1LightCalc from "./source/web_gl1/chunks/light_calc.frag.glsl?raw";
import gl1PbrMath from "./source/web_gl1/chunks/pbr_math.frag.glsl?raw";
import gl1LightCalcPbr from "./source/web_gl1/chunks/light_calc_pbr.frag.glsl?raw";
import gl1BaseVs from "./source/web_gl1/base.vert.glsl?raw";
import gl1BaseFs from "./source/web_gl1/base.frag.glsl?raw";

// --- WebGPU ---
import wgslStructs from "./source/web_gpu/chunks/structs.wgsl?raw";
import wgslLighting from "./source/web_gpu/chunks/lighting.wgsl?raw";
import wgslPbrMath from "./source/web_gpu/chunks/pbr_math.wgsl?raw";
import wgslPbrLighting from "./source/web_gpu/chunks/lighting_pbr.wgsl?raw";
import wgslFogCalc from "./source/web_gpu/chunks/fog_calc.wgsl?raw";
import wgslSdfMath from "./source/web_gpu/chunks/sdf_math.wgsl?raw";
import wgslScreenFootprint from "./source/web_gpu/chunks/screen_footprint.wgsl?raw";
import wgslBaseVs from "./source/web_gpu/base.vert.wgsl?raw";
import { ShaderRegistry } from "./ShaderRegistry.js";

/**
 * Utility to load and register all standard shader chunks used by the engine.
 */
export class CoreShaderChunks {
  private static _bootstrapped: WeakSet<ShaderRegistry> = new WeakSet();

  /**
   * Initializes the registry with all standard chunks for all supported languages.
   */
  public static init(registry: ShaderRegistry = ShaderRegistry.instance): void {
    if (this._bootstrapped.has(registry)) {
      return;
    }

    // --- WebGL 2 Chunks ---
    registry.registerChunk("BASE_VERTEX_HEADER", gl2BaseVsHeader, "glsl300");
    registry.registerChunk("BASE_VERTEX_MAIN", gl2BaseVsMain, "glsl300");
    registry.registerChunk("BASE_FRAGMENT_HEADER", gl2BaseFsHeader, "glsl300");
    registry.registerChunk("LIGHT_DEFS", gl2LightDefs, "glsl300");
    registry.registerChunk("LIGHT_CALC", gl2LightCalc, "glsl300");
    registry.registerChunk("PBR_MATH", gl2PbrMath, "glsl300");
    registry.registerChunk("LIGHT_CALC_PBR", gl2LightCalcPbr, "glsl300");
    registry.registerChunk("SDF_MATH", gl2SdfMath, "glsl300");
    registry.registerChunk("DIR_SHADOW", DIR_SHADOW_GLSL, "glsl300");
    registry.registerChunk("FOG_DEFS", FOG_DEFS, "glsl300");
    registry.registerChunk("FOG_CALC", FOG_CALC, "glsl300");
    registry.registerChunk("LIQUID_GERSTNER_WAVE", LIQUID_GERSTNER_WAVE_GLSL, "glsl300");
    registry.registerChunk("LIQUID_WORLEY_NOISE", LIQUID_WORLEY_NOISE_GLSL, "glsl300");
    registry.registerChunk("LIQUID_CAUSTICS", LIQUID_CAUSTICS_GLSL, "glsl300");
    registry.registerChunk("LIQUID_GLINT", LIQUID_GLINT_GLSL, "glsl300");
    registry.registerChunk("WATER_EXT_DECL", LIQUID_EXT_DEFAULT_GLSL, "glsl300");
    registry.registerChunk("WATER_EXT_SURFACE", LIQUID_EXT_DEFAULT_GLSL, "glsl300");

    // --- WebGL 1 Chunks ---
    registry.registerChunk("BASE_VS", gl1BaseVs, "glsl100");
    registry.registerChunk("BASE_FS_HEADER", gl1BaseFs, "glsl100");
    registry.registerChunk("LIGHT_DEFS", gl1LightDefs, "glsl100");
    registry.registerChunk("LIGHT_CALC", gl1LightCalc, "glsl100");
    registry.registerChunk("PBR_MATH", gl1PbrMath, "glsl100");
    registry.registerChunk("LIGHT_CALC_PBR", gl1LightCalcPbr, "glsl100");
    registry.registerChunk("SDF_MATH", gl2SdfMath, "glsl100");
    registry.registerChunk("DIR_SHADOW", DIR_SHADOW_WEBGL1_GLSL, "glsl100");
    registry.registerChunk("FOG_DEFS", FOG_DEFS, "glsl100");
    registry.registerChunk("FOG_CALC", FOG_CALC, "glsl100");
    registry.registerChunk("LIQUID_GERSTNER_WAVE", LIQUID_GERSTNER_WAVE_GLSL, "glsl100");
    registry.registerChunk("LIQUID_WORLEY_NOISE", LIQUID_WORLEY_NOISE_GLSL, "glsl100");
    registry.registerChunk("LIQUID_CAUSTICS", LIQUID_CAUSTICS_GLSL, "glsl100");
    registry.registerChunk("LIQUID_GLINT", LIQUID_GLINT_GLSL, "glsl100");
    registry.registerChunk("WATER_EXT_DECL", LIQUID_EXT_DEFAULT_GLSL, "glsl100");
    registry.registerChunk("WATER_EXT_SURFACE", LIQUID_EXT_DEFAULT_GLSL, "glsl100");

    // --- WebGPU Chunks ---
    registry.registerChunk("WGSL_STRUCTS", wgslStructs, "wgsl");
    registry.registerChunk("WGSL_LIGHTING", wgslLighting, "wgsl");
    registry.registerChunk("WGSL_PBR_MATH", wgslPbrMath, "wgsl");
    registry.registerChunk("WGSL_PBR_LIGHTING", wgslPbrLighting, "wgsl");
    registry.registerChunk("WGSL_DIR_SHADOW", DIR_SHADOW_WGSL, "wgsl");
    registry.registerChunk("WGSL_FOG_CALC", wgslFogCalc, "wgsl");
    registry.registerChunk("WGSL_SDF_MATH", wgslSdfMath, "wgsl");
    registry.registerChunk("WGSL_SCREEN_FOOTPRINT", wgslScreenFootprint, "wgsl");
    registry.registerChunk("WGSL_LIQUID_GERSTNER_WAVE", LIQUID_GERSTNER_WAVE_WGSL, "wgsl");
    registry.registerChunk("WGSL_LIQUID_WORLEY_NOISE", LIQUID_WORLEY_NOISE_WGSL, "wgsl");
    registry.registerChunk("WGSL_LIQUID_CAUSTICS", LIQUID_CAUSTICS_WGSL, "wgsl");
    registry.registerChunk("WGSL_LIQUID_GLINT", LIQUID_GLINT_WGSL, "wgsl");
    registry.registerChunk("WGSL_WATER_EXT_DECL", LIQUID_EXT_DEFAULT_WGSL, "wgsl");
    registry.registerChunk("WGSL_WATER_EXT_SURFACE", LIQUID_EXT_DEFAULT_WGSL, "wgsl");
    registry.registerChunk("WGSL_VS", wgslBaseVs, "wgsl");

    // --- Post-Processing Filter Chunks ---
    registry.registerChunk("FILTER_GLITCH_DISTORT", FILTER_GLITCH_DISTORT_GLSL, "glsl300");
    registry.registerChunk("FILTER_GLITCH_DISTORT", FILTER_GLITCH_DISTORT_WGSL, "wgsl");

    registry.registerChunk("FILTER_VHS_DISTORT", FILTER_VHS_DISTORT_GLSL, "glsl300");
    registry.registerChunk("FILTER_VHS_DISTORT", FILTER_VHS_DISTORT_WGSL, "wgsl");

    // Dynamically assemble GLSL color grading filters
    const filterColorGradingGLSL = `
    if (u_filterMode == 1) { // Night Vision
        ${filterNightVisionGLSL}
    } else if (u_filterMode == 2) { // Noir Detective
        ${filterNoirGLSL}
    } else if (u_filterMode == 3) { // Cyber Glitch
        ${filterCyberGlitchGLSL}
    } else if (u_filterMode == 4) { // VHS Tape
        ${filterVhsTapeGLSL}
    } else if (u_filterMode == 5) { // Underworld
        ${filterUnderworldGLSL}
    } else if (u_filterMode == 6) { // Old Projector
        ${filterOldProjectorGLSL}
    } else if (u_filterMode == 7) { // Thermal Vision
        ${filterThermalVisionGLSL}
    }
    `;

    // Dynamically assemble WGSL color grading filters
    const filterColorGradingWGSL = `
    if (1u == u_filterMode) { // Night Vision
        ${filterNightVisionWGSL}
    } else if (2u == u_filterMode) { // Noir Detective
        ${filterNoirWGSL}
    } else if (3u == u_filterMode) { // Cyber Glitch
        ${filterCyberGlitchWGSL}
    } else if (4u == u_filterMode) { // VHS Tape
        ${filterVhsTapeWGSL}
    } else if (5u == u_filterMode) { // Underworld
        ${filterUnderworldWGSL}
    } else if (6u == u_filterMode) { // Old Projector
        ${filterOldProjectorWGSL}
    } else if (7u == u_filterMode) { // Thermal Vision
        ${filterThermalVisionWGSL}
    }
    `;

    registry.registerChunk("FILTER_COLOR_GRADING", filterColorGradingGLSL, "glsl300");
    registry.registerChunk("FILTER_COLOR_GRADING", filterColorGradingWGSL, "wgsl");

    this._bootstrapped.add(registry);
  }
}
