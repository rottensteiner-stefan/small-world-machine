import { registerGltfExtension } from "@small-world-machine/engine";
import { khrDracoMeshCompression } from "./draco/KhrDracoMeshCompression.js";
import { khrTextureBasisu } from "./basisu/KhrTextureBasisu.js";

registerGltfExtension(khrDracoMeshCompression);
registerGltfExtension(khrTextureBasisu);

export { khrDracoMeshCompression, khrTextureBasisu };
