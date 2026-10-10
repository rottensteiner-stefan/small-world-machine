import { registerGltfExtension } from "../GltfExtensionRegistry.js";
import { khrLightsPunctual } from "./KhrLightsPunctual.js";
import { swmPrefabInstance } from "./SwmPrefabInstance.js";
import { swmStageZone } from "./SwmStageZone.js";

registerGltfExtension(khrLightsPunctual);
registerGltfExtension(swmPrefabInstance);
registerGltfExtension(swmStageZone);

export { khrLightsPunctual, swmPrefabInstance, swmStageZone };
