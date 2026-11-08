import windGLSL from "./shaders/chunks/wind_field.glsl?raw";
import windWGSL from "./shaders/chunks/wind_field.wgsl?raw";

/** WGSL function chunk: `SwmWind` struct + `swmWindGust` / `swmWindLean` / `swmWindBend`. */
export const WIND_FIELD_WGSL: string = windWGSL;
/** GLSL ES 1.00 / 3.00 function chunk with the same names and math as `WIND_FIELD_WGSL`. */
export const WIND_FIELD_GLSL: string = windGLSL;
