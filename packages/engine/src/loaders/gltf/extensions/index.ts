import { registerGltfExtension } from "../GltfExtensionRegistry.js";
import { khrLightsPunctual } from "./KhrLightsPunctual.js";
import { swmDecal } from "./SwmDecal.js";
import { swmPrefabInstance } from "./SwmPrefabInstance.js";
import { swmStageZone } from "./SwmStageZone.js";

registerGltfExtension(khrLightsPunctual);
registerGltfExtension(swmPrefabInstance);
registerGltfExtension(swmStageZone);
registerGltfExtension(swmDecal);

export { khrLightsPunctual, swmDecal, swmPrefabInstance, swmStageZone };
