import type { QualityConfig } from "../interfaces/EngineOptions.js";
import type { Texture } from "../core/textures/Texture.js";

const ANISOTROPY_EXTENSIONS = [
  "EXT_texture_filter_anisotropic",
  "WEBKIT_EXT_texture_filter_anisotropic",
  "MOZ_EXT_texture_filter_anisotropic",
] as const;

interface AnisotropyCaps {
  extension: EXT_texture_filter_anisotropic;
  deviceMax: number;
}

/**
 * The extension and device maximum are resolved once per GL context and memoized here. Keyed by
 * the context object, so the cache never outlives an engine instance and needs no explicit
 * teardown (multiple engine instances per page each key into their own entry).
 */
const capsByContext = new WeakMap<
  WebGLRenderingContext | WebGL2RenderingContext,
  AnisotropyCaps | null
>();

/**
 * Resolves the effective anisotropic-filtering level for `tex`, clamped to the engine-wide
 * `quality.maxAnisotropy` cap and the device maximum. `tex.anisotropy` sentinels: `0` disables,
 * the default `1` inherits the engine level, `> 1` is taken literally (still capped). Never
 * below 1 (filtering off). This is the single source of truth for the level -- both WebGL
 * backends call it so their semantics cannot drift.
 */
export function resolveAnisotropicLevel(
  tex: Texture,
  quality: QualityConfig | undefined,
  deviceMax: number,
): number {
  let requested = tex.anisotropy;
  if (requested <= 0) return 1;
  const engineLevel = quality?.maxAnisotropy;
  if (requested === 1 && engineLevel !== undefined) requested = engineLevel;
  return Math.max(1, Math.min(requested, engineLevel ?? requested, deviceMax));
}

/**
 * Applies `tex`'s anisotropic-filtering level to the GL texture bound to `target`. No-op when
 * the device has no `EXT_texture_filter_anisotropic` extension, the resolved level is 1, or the
 * texture does not use mipmaps (the filter only sharpens mip-selected sampling, so it would be
 * meaningless on a non-mipmapped texture).
 */
export function applyAnisotropy(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  target: number,
  tex: Texture,
  quality: QualityConfig | undefined,
  useMipmaps: boolean,
): void {
  let caps = capsByContext.get(gl);
  if (caps === undefined) {
    caps = resolveAnisotropyExtension(gl);
    capsByContext.set(gl, caps);
  }
  if (caps === null) return;
  const level = resolveAnisotropicLevel(tex, quality, caps.deviceMax);
  if (level < 2 || !useMipmaps) return;
  gl.texParameterf(target, caps.extension.TEXTURE_MAX_ANISOTROPY_EXT, level);
}

function resolveAnisotropyExtension(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): AnisotropyCaps | null {
  for (const name of ANISOTROPY_EXTENSIONS) {
    const extension = gl.getExtension(name);
    if (extension) {
      return {
        extension,
        deviceMax: gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT),
      };
    }
  }
  return null;
}
