import {
  Object3D,
  Plane,
  StandardMaterial,
  Color,
  Texture,
  CullMode,
  KitRegistry,
} from "@small-world-machine/engine";
import type { CameraFrame, InspectedAssetInfo } from "../types.js";

export interface DecalViewResult {
  root: Object3D;
  info: InspectedAssetInfo;
  cameraFrame: CameraFrame;
}

export interface DecalItem {
  id: string;
  name: string;
  file: string;
}

export async function buildDecalView(
  reg: KitRegistry,
  kitId: string,
  decalItem: DecalItem,
): Promise<DecalViewResult> {
  const fileUrl = `${reg.basePath}${kitId}/decals/${decalItem.file}`;
  const decalTex = await Texture.fromUrl(fileUrl, {
    assetManager: reg.assetManager,
    flipY: true,
  });

  // Dynamically determine aspect ratio from the decoded image to avoid distortion
  let aspect = 1.0;
  if (decalTex.image && "width" in decalTex.image && "height" in decalTex.image) {
    aspect = decalTex.image.width / Math.max(1, decalTex.image.height);
  }

  const planeWidth = aspect >= 1.0 ? 1.6 : 1.6 * aspect;
  const planeHeight = aspect >= 1.0 ? 1.6 / aspect : 1.6;

  const quadGeo = new Plane({ width: planeWidth, height: planeHeight }).getGeometryData();
  const decalQuad = new Object3D("DecalQuad");
  decalQuad.geometry = quadGeo;

  const mat = new StandardMaterial({
    color: Color.WHITE,
    diffuseMap: decalTex,
    roughness: 0.6,
    metallic: 0.1,
  });
  mat.transparent = true;
  mat.cullMode = CullMode.NONE;

  decalQuad.material = mat;
  decalQuad.position.set(0, 0.85, 0);

  const manifest = await reg.getKitManifest(kitId);
  const info: InspectedAssetInfo = {
    type: "decal",
    id: decalItem.id,
    kitId,
    name: decalItem.name,
    category: "decals",
    description: `Grafischer Decal-Sticker aus dem Kit '${kitId}'.`,
    author: manifest.author,
    license: manifest.license,
    version: manifest.version,
    previewUrl: fileUrl,
    decalFile: fileUrl,
  };

  const cameraFrame: CameraFrame = {
    target: { x: 0, y: 0.85, z: 0 },
    distance: 2.4,
    yaw: 0,
    pitch: 0.05,
  };

  return {
    root: decalQuad,
    info,
    cameraFrame,
  };
}
