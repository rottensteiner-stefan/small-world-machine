import { GltfExtensionPlugin } from "./GltfExtensionPlugin.js";

const registry: GltfExtensionPlugin[] = [];

/** Registers a glTF extension plugin so `GltfLoader`/`WorldWriter` pick it up automatically --
 * see ADR 0017. Built-in extensions self-register via a side-effect import of
 * `./extensions/index.js`; a consumer can register additional ones (e.g. from a separate
 * `@small-world-machine/gltf-extensions`-style package) the exact same way. */
export function registerGltfExtension(plugin: GltfExtensionPlugin): void {
  const existingIdx = registry.findIndex((p) => p.name === plugin.name);
  if (existingIdx >= 0) {
    registry[existingIdx] = plugin;
  } else {
    registry.push(plugin);
  }
}

export function unregisterGltfExtension(name: string): void {
  const idx = registry.findIndex((p) => p.name === name);
  if (idx >= 0) {
    registry.splice(idx, 1);
  }
}

export function getGltfExtensions(): readonly GltfExtensionPlugin[] {
  return registry;
}
