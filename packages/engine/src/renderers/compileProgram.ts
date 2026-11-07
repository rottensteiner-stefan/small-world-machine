type GL = WebGLRenderingContext | WebGL2RenderingContext;

function compileShader(gl: GL, type: number, source: string, label: string): WebGLShader {
  const kind: string = type === gl.VERTEX_SHADER ? "vertex" : "fragment";
  const shader: WebGLShader | null = gl.createShader(type);
  if (!shader) {
    throw new Error(`[${label}] createShader(${kind}) failed (context lost?).`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log: string | null = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[${label}] ${kind} shader compile error: ${log ?? "(no info log)"}`);
  }
  return shader;
}

/**
 * Compiles and links a shader program. Throws (fail fast, with the program's `label` and the GL info
 * log) on any compile or link error; every intermediate GL object is released on the way out.
 * @param gl The WebGL1 or WebGL2 context.
 * @param vertSrc Vertex shader source.
 * @param fragSrc Fragment shader source.
 * @param label Name used in error messages, e.g. `"AOPassGL"`.
 * @param attributeLocations Optional fixed attribute locations (location to attribute name), bound before linking.
 * @returns The linked program.
 */
export function compileProgram(
  gl: GL,
  vertSrc: string,
  fragSrc: string,
  label: string,
  attributeLocations?: Iterable<readonly [number, string]>,
): WebGLProgram {
  const vert: WebGLShader = compileShader(gl, gl.VERTEX_SHADER, vertSrc, label);
  let frag: WebGLShader | undefined;
  let prog: WebGLProgram | null = null;
  try {
    frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc, label);
    prog = gl.createProgram();
    if (!prog) {
      throw new Error(`[${label}] createProgram() failed (context lost?).`);
    }
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    if (attributeLocations) {
      for (const [location, name] of attributeLocations)
        gl.bindAttribLocation(prog, location, name);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(
        `[${label}] program link error: ${gl.getProgramInfoLog(prog) ?? "(no info log)"}`,
      );
    }
    return prog;
  } catch (err) {
    if (prog) gl.deleteProgram(prog);
    throw err;
  } finally {
    gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
  }
}

/**
 * Like {@link compileProgram}, but for optional effects that degrade by switching themselves off:
 * logs the error to the console (so it stays visible) and returns `null` instead of throwing.
 * @param gl The WebGL1 or WebGL2 context.
 * @param vertSrc Vertex shader source.
 * @param fragSrc Fragment shader source.
 * @param label Name used in error messages.
 * @returns The linked program, or `null` when compilation or linking failed.
 */
export function tryCompileProgram(
  gl: GL,
  vertSrc: string,
  fragSrc: string,
  label: string,
): WebGLProgram | null {
  try {
    return compileProgram(gl, vertSrc, fragSrc, label);
  } catch (err) {
    console.error((err as Error).message);
    return null;
  }
}
