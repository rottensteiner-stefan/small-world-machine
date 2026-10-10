import {
  Object3D,
  Sphere,
  PointLight,
  Color,
  Vector3D,
  BasicMaterial,
  BoundingType,
  BoundingBox,
  KitRegistry,
} from "@small-world-machine/engine";
import type { KitSocket } from "@small-world-machine/engine";
import type { CameraFrame, InspectedAssetInfo } from "../types.js";

export interface PropViewResult {
  root: Object3D;
  socketsRoot: Object3D;
  info: InspectedAssetInfo;
  cameraFrame: CameraFrame;
}

export function computeHierarchyBounds(root: Object3D): BoundingBox {
  const min = new Vector3D(Infinity, Infinity, Infinity);
  const max = new Vector3D(-Infinity, -Infinity, -Infinity);
  let foundGeometry = false;

  root.traverse((child) => {
    if (!child.geometry) return;
    const bv = child.geometry.getBoundingVolume();
    if (bv && bv.type === BoundingType.BOX) {
      const box = bv as BoundingBox;
      foundGeometry = true;
      min.x = Math.min(min.x, box.min.x * child.scale.x + child.position.x);
      min.y = Math.min(min.y, box.min.y * child.scale.y + child.position.y);
      min.z = Math.min(min.z, box.min.z * child.scale.z + child.position.z);
      max.x = Math.max(max.x, box.max.x * child.scale.x + child.position.x);
      max.y = Math.max(max.y, box.max.y * child.scale.y + child.position.y);
      max.z = Math.max(max.z, box.max.z * child.scale.z + child.position.z);
    }
  });

  if (!foundGeometry) {
    return new BoundingBox(new Vector3D(-0.5, 0, -0.5), new Vector3D(0.5, 1.0, 0.5));
  }
  return new BoundingBox(min, max);
}

export function buildSocketGizmos(sockets?: KitSocket[], parent?: Object3D): Object3D {
  const container = new Object3D("SocketGizmosContainer");
  if (!sockets || sockets.length === 0) return container;

  const sphereGeo = new Sphere({
    radius: 0.04,
    widthSegments: 16,
    heightSegments: 12,
  }).getGeometryData();

  for (const socket of sockets) {
    const lightColorHex = socket.recommendedLight?.color ?? "#ffd273";
    const lightCol = Color.fromHex(lightColorHex);

    const marker = new Object3D(`SocketMarker_${socket.name}`);
    marker.geometry = sphereGeo;
    marker.material = new BasicMaterial({ color: lightCol });
    marker.position.set(socket.position[0], socket.position[1], socket.position[2]);

    const pLight = new PointLight({
      name: `SocketLight_${socket.name}`,
      color: lightCol,
      intensity: Math.min(socket.recommendedLight?.intensity ?? 1.5, 3.0),
      distance: socket.recommendedLight?.distance ?? 4.0,
    });
    pLight.position.set(socket.position[0], socket.position[1], socket.position[2]);

    if (parent) {
      parent.add(marker);
      parent.add(pLight);
    } else {
      container.add(marker);
      container.add(pLight);
    }
  }

  return container;
}

export async function buildPropView(reg: KitRegistry, kitPropId: string): Promise<PropViewResult> {
  const parts = kitPropId.split("/");
  const kitId = parts[0] ?? "";
  const manifest = await reg.getKitManifest(kitId);
  const meta = await reg.getPropMeta(kitPropId);
  const propInst = await reg.loadProp(kitPropId);

  const bounds = computeHierarchyBounds(propInst.root);
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeY = bounds.max.y - bounds.min.y;
  const sizeZ = bounds.max.z - bounds.min.z;
  const maxDim = Math.max(sizeX, sizeY, sizeZ, 0.1);

  // Center model horizontally and align bottom to ground (y=0)
  propInst.root.position.x -= bounds.center.x;
  propInst.root.position.z -= bounds.center.z;
  propInst.root.position.y -= bounds.min.y;

  const socketsRoot = buildSocketGizmos(meta.sockets, propInst.root);

  const itemDef = (manifest.items ?? []).find((it) => it.id === kitPropId);
  const previewPath = itemDef ? `${reg.basePath}${kitId}/${itemDef.preview}` : "";

  const info: InspectedAssetInfo = {
    type: "prop",
    id: kitPropId,
    kitId,
    name: meta.name,
    category: meta.category,
    description: meta.description,
    author: meta.author,
    license: meta.license,
    version: meta.version,
    previewUrl: previewPath,
    triangles: meta.triangles,
    materialsCount: meta.materials,
    dimensions: {
      width: meta.dimensions.width ?? meta.dimensions.radius ?? sizeX,
      height: meta.dimensions.height ?? sizeY,
      depth: meta.dimensions.depth ?? meta.dimensions.radius ?? sizeZ,
    },
    recommendedScale: meta.recommendedScale,
    sockets: meta.sockets,
  };

  const cameraFrame: CameraFrame = {
    target: { x: 0, y: sizeY * 0.5, z: 0 },
    distance: Math.max(0.6, maxDim * 2.2),
  };

  return {
    root: propInst.root,
    socketsRoot,
    info,
    cameraFrame,
  };
}
