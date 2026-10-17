import { Decal } from "../../../core/objects/Decal.js";
import { createDecalShell, decalToPayload, type SwmDecalPayload } from "../../kit/DecalShell.js";
import type { GltfExtensionPlugin } from "../GltfExtensionPlugin.js";

/**
 * `SWM_decal` -- a box-projected decal (ADR 0029) with the payload of a `LevelDecalPlacement`.
 * Transform and hierarchy come from the node; `size` in the payload is authoritative and the node
 * scale (written as (w, depth, h) so plain glTF viewers see the box too) is rewritten from it on
 * read. `readNode` is synchronous, so the decal comes back texture-less:
 * `KitRegistry.hydrateDecal`/`resolveLevelDecals` load the maps afterwards.
 */
export const swmDecal: GltfExtensionPlugin = {
  name: "SWM_decal",

  readNode(_nodeIndex, nodeDef, name, _ctx) {
    const def = nodeDef.extensions?.["SWM_decal"] as SwmDecalPayload | undefined;
    if (!def) return undefined;
    return createDecalShell({ id: name, ...def });
  },

  applyNode(obj, nodeDef, _ctx) {
    const def = nodeDef.extensions?.["SWM_decal"] as SwmDecalPayload | undefined;
    if (!def || !(obj instanceof Decal)) return;
    // Runs after the node TRS: the payload size wins over whatever scale the node carried.
    obj.scale.set(def.size[0], def.size[2], def.size[1]);
  },

  writeNode(obj, node) {
    if (!(obj instanceof Decal) || obj.kitDecal === undefined) return;
    node.extensions = { ...node.extensions, SWM_decal: decalToPayload(obj, obj.kitDecal) };
  },
};
