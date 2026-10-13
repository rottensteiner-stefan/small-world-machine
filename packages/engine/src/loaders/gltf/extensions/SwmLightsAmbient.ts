import { AmbientLight } from "../../../core/lights/AmbientLight.js";
import { Color } from "../../../core/colors/Color.js";
import { GltfExtensionPlugin } from "../GltfExtensionPlugin.js";

/**
 * `SWM_lights_ambient` -- an `AmbientLight`. `KHR_lights_punctual` only describes punctual lights
 * (point, directional, spot), so ambient light is a node-local vendor extension, like
 * `SWM_stage_zone`: color and intensity live on the node itself, no root-level array.
 */
export const swmLightsAmbient: GltfExtensionPlugin = {
  name: "SWM_lights_ambient",

  readNode(_nodeIndex, nodeDef, name, _ctx) {
    const def = nodeDef.extensions?.SWM_lights_ambient;
    if (!def) return undefined;
    const options: ConstructorParameters<typeof AmbientLight>[0] = { name };
    if (def.color) options.color = new Color(def.color[0]!, def.color[1]!, def.color[2]!);
    if (undefined !== def.intensity) options.intensity = def.intensity;
    return new AmbientLight(options);
  },

  writeNode(obj, node) {
    if (!(obj instanceof AmbientLight)) return;
    node.extensions = {
      ...node.extensions,
      SWM_lights_ambient: {
        color: [obj.color.r, obj.color.g, obj.color.b],
        intensity: obj.intensity,
      },
    };
  },
};
