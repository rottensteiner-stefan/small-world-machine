import type { KitRegistry } from "@small-world-machine/engine";
import {
  Object3D,
  Sphere,
  StandardMaterial,
  Color,
  pickKitTextureMap,
} from "@small-world-machine/engine";
import type { CameraFrame, InspectedAssetInfo } from "../types.js";

export interface PbrViewResult {
  root: Object3D;
  info: InspectedAssetInfo;
  cameraFrame: CameraFrame;
}

export interface PbrTextureItem {
  id: string;
  name: string;
  category?: string;
  maps: string[];
}

export async function buildPbrView(
  reg: KitRegistry,
  kitId: string,
  texItem: PbrTextureItem,
): Promise<PbrViewResult> {
  const sphereGeo = new Sphere({
    radius: 0.8,
    widthSegments: 36,
    heightSegments: 24,
  }).getGeometryData();
  const pbrSphere = new Object3D("PbrPreviewSphere");
  pbrSphere.geometry = sphereGeo;

  // Map loading is shared with the Maker via `KitRegistry.resolveTextureMaps`
  // (exact-token matching, parallel `Promise.all` load); only the preview-URL
  // string is derived here, through the same exact-token matcher.
  const slug = texItem.id.includes("/") ? texItem.id.split("/").pop()! : texItem.id;
  const base = `${reg.basePath}${kitId}/textures/${slug}`;
  const mat = new StandardMaterial({
    color: Color.WHITE,
    roughness: 0.5,
    metallic: 0.0,
  });

  const maps = await reg.resolveTextureMaps(kitId, texItem);
  if (maps.albedo) {
    mat.diffuseMap = maps.albedo;
  }
  if (maps.normal) {
    mat.normalMap = maps.normal;
  }
  if (maps.roughness) {
    mat.roughnessMap = maps.roughness;
  }
  if (maps.ao) {
    mat.aoMap = maps.ao;
  }
  if (maps.metalness) {
    mat.metallicMap = maps.metalness;
    mat.metallic = 1.0;
  }

  pbrSphere.material = mat;
  pbrSphere.position.set(0, 0.85, 0);

  const manifest = await reg.getKitManifest(kitId);
  const albedoFile = pickKitTextureMap(texItem.maps, "albedo");
  const info: InspectedAssetInfo = {
    type: "texture",
    id: texItem.id,
    kitId,
    name: texItem.name,
    category: texItem.category ?? "surfaces",
    description: `PBR-Textursatz aus dem Kit '${kitId}' mit ${texItem.maps.length} Texturkanälen.`,
    author: manifest.author,
    license: manifest.license,
    version: manifest.version,
    previewUrl: albedoFile ? `${base}/${albedoFile}` : "",
    textureMaps: texItem.maps.map((m) => `${base}/${m}`),
  };

  const cameraFrame: CameraFrame = {
    target: { x: 0, y: 0.85, z: 0 },
    distance: 2.4,
  };

  return {
    root: pbrSphere,
    info,
    cameraFrame,
  };
}
