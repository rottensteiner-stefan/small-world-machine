import {
  Object3D,
  Sphere,
  StandardMaterial,
  Color,
  Texture,
  KitRegistry,
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

  // maps[] are bare filenames; actual files live under textures/<slug>/
  const slug = texItem.id.includes("/") ? texItem.id.split("/").pop()! : texItem.id;
  const base = `${reg.basePath}${kitId}/textures/${slug}`;
  const mat = new StandardMaterial({
    color: Color.WHITE,
    roughness: 0.5,
    metallic: 0.0,
  });

  const findMapUrl = (keyword: string): string | undefined => {
    const found = texItem.maps.find((m) => m.toLowerCase().includes(keyword));
    return found ? `${base}/${found}` : undefined;
  };

  const albedoUrl = findMapUrl("albedo") ?? findMapUrl("diffuse");
  const normalUrl = findMapUrl("normal");
  const roughnessUrl = findMapUrl("roughness");
  const aoUrl = findMapUrl("ao");
  const metalnessUrl = findMapUrl("metalness") ?? findMapUrl("metallic");

  const textureOptions = { assetManager: reg.assetManager };
  if (albedoUrl) {
    mat.diffuseMap = await Texture.fromUrl(albedoUrl, textureOptions);
  }
  if (normalUrl) {
    mat.normalMap = await Texture.fromUrl(normalUrl, textureOptions);
  }
  if (roughnessUrl) {
    mat.roughnessMap = await Texture.fromUrl(roughnessUrl, textureOptions);
  }
  if (aoUrl) {
    mat.aoMap = await Texture.fromUrl(aoUrl, textureOptions);
  }
  if (metalnessUrl) {
    mat.metallicMap = await Texture.fromUrl(metalnessUrl, textureOptions);
    mat.metallic = 1.0;
  }

  pbrSphere.material = mat;
  pbrSphere.position.set(0, 0.85, 0);

  const manifest = await reg.getKitManifest(kitId);
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
    previewUrl: albedoUrl ?? "",
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
