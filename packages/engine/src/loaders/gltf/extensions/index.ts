import { registerGltfExtension } from "../GltfExtensionRegistry.js";
import { extTextureWebp } from "./ExtTextureWebp.js";
import { khrLightsPunctual } from "./KhrLightsPunctual.js";
import { swmLightsAmbient } from "./SwmLightsAmbient.js";
import { swmDecal } from "./SwmDecal.js";
import { swmPrefabInstance } from "./SwmPrefabInstance.js";
import { swmStageZone } from "./SwmStageZone.js";

registerGltfExtension(khrLightsPunctual);
registerGltfExtension(swmPrefabInstance);
registerGltfExtension(swmStageZone);
registerGltfExtension(swmDecal);
registerGltfExtension(swmLightsAmbient);
registerGltfExtension(extTextureWebp);

export {
  extTextureWebp,
  khrLightsPunctual,
  swmDecal,
  swmLightsAmbient,
  swmPrefabInstance,
  swmStageZone,
};
