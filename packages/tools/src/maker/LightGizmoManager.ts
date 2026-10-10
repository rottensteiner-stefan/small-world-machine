import {
  Object3D,
  AbstractLight,
  PointLight,
  DirectionalLight,
  SpotLight,
  BasicMaterial,
  WireframeMaterial,
  Octahedron,
  Sphere,
  Cone,
  Cylinder,
  Camera,
} from "@small-world-machine/engine";

interface LightGizmoEntry {
  light: AbstractLight;
  marker: Object3D;
  markerMat: BasicMaterial;
  rangeGizmo: Object3D | undefined;
  rangeMat: WireframeMaterial | undefined;
  lastDistance: number | undefined;
  lastAngle: number | undefined;
}

/**
 * Manages 3D editor representations (icons/glyphs and selection range volumes) for all
 * lights in the Maker scene graph.
 */
export class LightGizmoManager {
  public readonly root = new Object3D("MakerLightGizmos");
  private readonly _entries = new Map<AbstractLight, LightGizmoEntry>();
  private readonly _markerToLight = new Map<Object3D, AbstractLight>();
  /** Reused across frames; only repopulated via a full scene walk when `hierarchyChanged` is true. */
  private readonly _liveLights = new Set<AbstractLight>();

  constructor() {
    this.root.isVisible = true;
  }

  /**
   * Returns whether `obj` is the gizmo root or one of its descendants.
   */
  public isHelperMesh(obj: Object3D): boolean {
    let curr: Object3D | undefined = obj;
    while (curr) {
      if (curr === this.root) return true;
      curr = curr.parent;
    }
    return false;
  }

  /**
   * Returns the underlying `AbstractLight` associated with a clicked helper marker mesh.
   */
  public getLightForObject(obj: Object3D): AbstractLight | undefined {
    let curr: Object3D | undefined = obj;
    while (curr) {
      const light = this._markerToLight.get(curr);
      if (light) return light;
      curr = curr.parent;
    }
    return undefined;
  }

  /**
   * Collects all pickable marker meshes for raycasting.
   */
  public collectPickables(out: Object3D[]): void {
    for (const entry of this._entries.values()) {
      if (entry.marker.isVisible) {
        entry.marker.computeBounds();
        out.push(entry.marker);
      }
    }
  }

  /**
   * Syncs and updates all light gizmos with the current scene state.
   *
   * The full scene walk that discovers lights (`_findLights`) is only re-run when
   * `hierarchyChanged` is true (mirroring `MakerApp`'s `_hierarchyDirty` flag) -- otherwise the
   * cached `_liveLights` set from the previous hierarchy-changing frame is reused, avoiding a
   * per-frame allocation and a full `Object3D` tree traversal.
   */
  public update(
    sceneRoot: Object3D,
    selection: ReadonlySet<Object3D>,
    hierarchyChanged: boolean,
    camera?: Camera,
  ): void {
    if (hierarchyChanged) {
      this._liveLights.clear();
      this._findLights(sceneRoot, this._liveLights);
    }

    // Remove deleted lights
    for (const [light, entry] of this._entries.entries()) {
      if (!this._liveLights.has(light) || !light.parent) {
        this._removeEntry(entry);
        this._entries.delete(light);
      }
    }

    // Create or update live lights
    for (const light of this._liveLights) {
      let entry = this._entries.get(light);
      if (!entry) {
        entry = this._createEntry(light);
        this._entries.set(light, entry);
      }
      this._updateEntry(entry, selection.has(light), camera);
    }
  }

  private _findLights(parent: Object3D, out: Set<AbstractLight>): void {
    if (this.isHelperMesh(parent)) return;
    if (parent instanceof AbstractLight) {
      out.add(parent);
    }
    for (const child of parent.children) {
      this._findLights(child, out);
    }
  }

  private _createEntry(light: AbstractLight): LightGizmoEntry {
    const marker = new Object3D(`Helper_${light.name}`);
    const markerMat = new BasicMaterial({ color: light.color.clone() });

    if (light instanceof PointLight) {
      marker.geometry = new Octahedron({ radius: 0.2 }).getGeometryData();
      marker.material = markerMat;
    } else if (light instanceof DirectionalLight) {
      marker.geometry = new Sphere({
        radius: 0.2,
        widthSegments: 8,
        heightSegments: 6,
      }).getGeometryData();
      marker.material = markerMat;

      // Add directional arrow child
      const arrow = new Object3D("SunArrow");
      arrow.geometry = new Cylinder({
        radiusTop: 0.02,
        radiusBottom: 0.05,
        height: 0.5,
      }).getGeometryData();
      arrow.material = markerMat;
      arrow.position.set(0, 0, -0.3);
      arrow.rotation.set(Math.PI / 2, 0, 0);
      marker.add(arrow);
      this._markerToLight.set(arrow, light);
    } else if (light instanceof SpotLight) {
      marker.geometry = new Cone({ radius: 0.2, height: 0.4 }).getGeometryData();
      marker.material = markerMat;
      marker.rotation.set(Math.PI / 2, 0, 0);
    } else {
      // Ambient or general light
      marker.geometry = new Sphere({
        radius: 0.2,
        widthSegments: 6,
        heightSegments: 4,
      }).getGeometryData();
      marker.material = markerMat;
    }

    this._markerToLight.set(marker, light);
    this.root.add(marker);

    // Create selection range volume
    let rangeGizmo: Object3D | undefined;
    let rangeMat: WireframeMaterial | undefined;

    if (light instanceof PointLight) {
      rangeGizmo = new Object3D(`Range_${light.name}`);
      rangeMat = new WireframeMaterial(light.color.clone());
      rangeGizmo.geometry = new Sphere({
        radius: Math.min(light.distance, 10),
        widthSegments: 12,
        heightSegments: 8,
      }).getGeometryData();
      rangeGizmo.material = rangeMat;
      rangeGizmo.isVisible = false;
      this.root.add(rangeGizmo);
    } else if (light instanceof SpotLight) {
      rangeGizmo = new Object3D(`Cone_${light.name}`);
      rangeMat = new WireframeMaterial(light.color.clone());
      const dist = Math.min(light.distance, 15);
      const radius = Math.tan(light.angle) * dist;
      rangeGizmo.geometry = new Cone({ radius, height: dist }).getGeometryData();
      rangeGizmo.material = rangeMat;
      rangeGizmo.isVisible = false;
      this.root.add(rangeGizmo);
    }

    return {
      light,
      marker,
      markerMat,
      rangeGizmo,
      rangeMat,
      lastDistance:
        light instanceof PointLight
          ? light.distance
          : light instanceof SpotLight
            ? light.distance
            : undefined,
      lastAngle: light instanceof SpotLight ? light.angle : undefined,
    };
  }

  private _updateEntry(entry: LightGizmoEntry, isSelected: boolean, camera?: Camera): void {
    const { light, marker, markerMat, rangeGizmo, rangeMat } = entry;
    light.updateMatrixWorld();

    const worldPos = light.getWorldPosition();
    marker.position.copyFrom(worldPos);

    // Update color
    if (markerMat.color) {
      markerMat.color.r = light.color.r;
      markerMat.color.g = light.color.g;
      markerMat.color.b = light.color.b;
    }

    // Orient billboard / directional
    if (light instanceof DirectionalLight || light instanceof SpotLight) {
      marker.rotation.copyFrom(light.rotation);
    } else if (camera) {
      // Look at camera position for omni point/ambient lights
      marker.lookAt(camera.position);
    }

    // Sync selection range bounds
    if (rangeGizmo && rangeMat) {
      rangeGizmo.isVisible = isSelected;
      if (isSelected) {
        rangeGizmo.position.copyFrom(worldPos);
        rangeGizmo.rotation.copyFrom(light.rotation);

        rangeMat.color.r = light.color.r;
        rangeMat.color.g = light.color.g;
        rangeMat.color.b = light.color.b;

        // Rebuild geometry if distance/angle changed
        if (light instanceof PointLight) {
          if (entry.lastDistance !== light.distance) {
            entry.lastDistance = light.distance;
            const r = Math.min(light.distance, 20);
            rangeGizmo.geometry = new Sphere({
              radius: r,
              widthSegments: 12,
              heightSegments: 8,
            }).getGeometryData();
          }
        } else if (light instanceof SpotLight) {
          if (entry.lastDistance !== light.distance || entry.lastAngle !== light.angle) {
            entry.lastDistance = light.distance;
            entry.lastAngle = light.angle;
            const dist = Math.min(light.distance, 20);
            const radius = Math.tan(light.angle) * dist;
            rangeGizmo.geometry = new Cone({ radius, height: dist }).getGeometryData();
          }
        }
      }
    }
  }

  private _removeEntry(entry: LightGizmoEntry): void {
    this._markerToLight.delete(entry.marker);
    for (const child of entry.marker.children) {
      this._markerToLight.delete(child);
    }
    this.root.remove(entry.marker);
    if (entry.rangeGizmo) {
      this.root.remove(entry.rangeGizmo);
    }
  }
}
