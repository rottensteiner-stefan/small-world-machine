// Per-scene golden configuration (P5 Goldens): capturable scenes are declared in config.json under
// "scenes" (url, poolKeys, views, viewport, frames). Scene "10" -- the original "liquid" goldens --
// is the legacy default and resolves straight to the top-level config keys, so every existing
// invocation and the CI sharding keep working unchanged. New scenes (38, 39, ...) must be declared
// under config.scenes before they can be captured. The capture/compare query contract and the
// `${poolKey}__${view}.png` file naming are shared by every scene and do not change.

/**
 * Resolves a `--scene` key to a fully-populated capture spec. Scene "10" is the implicit default
 * (legacy liquid goldens); it reads its pools/views/viewport/frames from the top-level config keys
 * instead of a "scenes" entry, so no config duplication is needed and old CI sharding still works.
 *
 * @param {object} config The parsed config.json (top-level poolKeys/views/viewport/frames/scenes).
 * @param {string} key The `--scene` argument value (defaults to "10" upstream).
 * @returns {{ key: string, url: string, poolKeys: string[], views: string[], viewport: { width: number, height: number }, frames: number }}
 */
export function resolveSceneSpec(config, key) {
  if (!key || "10" === key) {
    return {
      key: "10",
      url: "apps/showcases/10/index.html",
      poolKeys: [...config.poolKeys],
      views: [...config.views],
      viewport: config.viewport,
      frames: config.frames,
    };
  }
  const scene = config.scenes?.[key];
  if (!scene) {
    const known = Object.keys(config.scenes ?? {}).join(", ") || "none";
    throw new Error(
      `Unknown --scene '${key}': no "scenes" entry in config.json (configured: ${known})`,
    );
  }
  if (!scene.url || !Array.isArray(scene.poolKeys) || !Array.isArray(scene.views)) {
    throw new Error(
      `--scene '${key}' needs "url", "poolKeys" and "views" in its config.json "scenes" entry`,
    );
  }
  return {
    key,
    url: scene.url,
    poolKeys: [...scene.poolKeys],
    views: [...scene.views],
    viewport: scene.viewport ?? config.viewport,
    frames: scene.frames ?? config.frames,
  };
}
