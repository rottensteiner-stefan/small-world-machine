import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/index.js";
import { StandardMaterial } from "../../src/core/materials/index.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";

/**
 * @invariant TRANSMISSION-TRANSPARENT-CLASSIFICATION: Ein Material mit `KHR_materials_transmission`
 *   (StandardMaterial `transmission > 0`, glTF `alphaMode` OPAQUE) gehört in die
 *   TRANSPARENT-Liste. Der `USE_TRANSMISSION`-Fragmentblock sampelt `u_opaqueMap`, das die
 *   Renderer NUR über den Opaque-Capture des Transparent-Passes befüllen
 *   (`copyToOpaqueTexture`/`captureOpaqueTexture`). Bliebe das Material im Opaque-Pass, sämple es
 *   die weiße Default-Textur und EXPLODIERT zu flachem Weiß (Showcase 50, ABeautifulGame
 *   Pawn-Finials). Der Fix klassifiziert Transmission-Materialien als transparent; die bestehenden
 *   Glas-Materialien (Glass/Frostglass) sind bereits `transparent=true` und unberührt.
 */
describe("SCENE TRANSMISSION-TRANSPARENT-CLASSIFICATION", () => {
  function makeDrawable(name: string, material: StandardMaterial): Object3D {
    const obj = new Object3D(name);
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.material = material;
    obj.frustumCulled = false; // unit test: no frustum pass runs, never gate on bounds
    return obj;
  }

  it("routes a transmission material (transparent=false) into the transparent list", () => {
    const scene = new Scene();
    const glass = makeDrawable(
      "GlassTop",
      new StandardMaterial({ transmission: 1, transparent: false }),
    );
    scene.add(glass);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D(), true);
    expect(list.transparent).toContain(glass);
    expect(list.opaqueBatches.flatMap((b) => b.objects.map((o) => o.name))).not.toContain(
      "GlassTop",
    );
  });

  it("keeps a non-transmission material (transparent=false) in the opaque list", () => {
    const scene = new Scene();
    const marble = makeDrawable("MarblePiece", new StandardMaterial({ transmission: 0 }));
    scene.add(marble);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D(), true);
    expect(list.transparent).not.toContain(marble);
    expect(list.opaqueBatches.flatMap((b) => b.objects.map((o) => o.name))).toContain(
      "MarblePiece",
    );
  });

  it("leaves an explicitly transparent material transparent regardless of transmission flag", () => {
    const scene = new Scene();
    const glass = makeDrawable(
      "ExplicitGlass",
      new StandardMaterial({ transmission: 1, transparent: true }),
    );
    scene.add(glass);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D(), true);
    expect(list.transparent).toContain(glass);
  });
});
