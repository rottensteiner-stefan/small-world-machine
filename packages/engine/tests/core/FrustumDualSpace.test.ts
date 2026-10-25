import { describe, expect, it } from "vitest";
import { Matrix4, Vector3D, Frustum } from "../../src/math/index.js";
import { BoundingBox } from "../../src/physix/index.js";

/**
 * @invariant FRUSTUM-DUAL-SPACE: Der Frustum/Contains-Test (Weltraum, Frustumplatten) ist
 *   konsistent zum NDC-Raum derselben View-Projection: `frustum.intersectsBox(Box(p))` ist
 *   äquivalent zu `p_ndc ∈ [-1,1]³` für Punkte, die nicht (innerhalb Toleranz) auf einer
 *   Frustumebene liegen. Ein Dual-Space-Widerspruch (Culler und Cliptest entscheiden
 *   unterschiedlich) wäre eine Sichtbarkeits-/Culling-Regression.
 */

const near = 0.1;
const far = 100;
const fov = Math.PI / 3;
const aspect = 16 / 9;

function buildFrustum(): { frustum: Frustum; vp: Matrix4; ndc: (p: Vector3D) => Vector3D } {
  const proj = new Matrix4();
  Matrix4.perspective(fov, aspect, near, far, proj);
  const view = new Matrix4();
  Matrix4.lookAt(new Vector3D(0, 0, 0), new Vector3D(0, 0, -1), new Vector3D(0, 1, 0), view);
  const vp = new Matrix4();
  Matrix4.multiply(proj, view, vp);
  const frustum = new Frustum();
  frustum.setFromMatrix(vp);
  const ndc = (p: Vector3D): Vector3D => {
    const d = vp.data;
    const cx = d[0]! * p.x + d[4]! * p.y + d[8]! * p.z + d[12]!;
    const cy = d[1]! * p.x + d[5]! * p.y + d[9]! * p.z + d[13]!;
    const cz = d[2]! * p.x + d[6]! * p.y + d[10]! * p.z + d[14]!;
    const cw = d[3]! * p.x + d[7]! * p.y + d[11]! * p.z + d[15]!;
    return new Vector3D(cx / cw, cy / cw, cz / cw);
  };
  return { frustum, vp, ndc };
}

const PAD = 0.01;

describe("FRUSTUM-DUAL-SPACE (world-frustum cull ⇔ NDC-in[-1,1]³)", () => {
  it("is consistent for clearly inside and clearly outside world points", () => {
    const { frustum, ndc } = buildFrustum();
    const probe = (p: Vector3D): void => {
      const box = new BoundingBox(
        new Vector3D(p.x - PAD, p.y - PAD, p.z - PAD),
        new Vector3D(p.x + PAD, p.y + PAD, p.z + PAD),
      );
      // Strikte Klassifikation ([−1,1]³ ohne Toleranz): alle Testpunkte sind klar von den
      // Frustumebenen entfernt (Margin ≥ 1e-3 im NDC), Float-Rauschen an der Grenze ist hier
      // also kein Ambiguitätsrisiko — andernfalls wäre der Test regressionsblind.
      const n = ndc(p);
      const ndcInside =
        n.x >= -1 &&
        n.x <= 1 &&
        n.y >= -1 &&
        n.y <= 1 &&
        n.z >= -1 &&
        n.z <= 1 &&
        Number.isFinite(n.x) &&
        Number.isFinite(n.y) &&
        Number.isFinite(n.z);
      expect(frustum.intersectsBox(box)).toBe(ndcInside);
    };

    // Blickrichtung -Z, Kamera im Ursprung: spreizt die Testpunkte über inside/outside je Achse.
    // Inside: im Kegel, zwischen near/far.
    for (const [u, vv, w] of [
      [0, 0, -5],
      [0.5, 0, -8],
      [-0.5, 0, -8],
      [0, 0.5, -8],
      [0, -0.5, -8],
      [0.2, -0.3, -12],
      [-0.8, 0.4, -30],
    ] as const) {
      probe(new Vector3D(u, vv, w));
    }
    // Outside: hinter der Kamera, weit links/rechts/oben/unten außerhalb des Kegels, jenseits far.
    for (const [u, vv, w] of [
      [0, 0, 5], // hinter der Kamera
      [6, 0, -5], // weit links, klar außerhalb des Kegels (Halbbreite @5 ~5.13)
      [-6, 0, -5],
      [0, 6, -5], // weit oben (Halbhöhe @5 ~2.89)
      [0, -6, -5],
      [0, 0, -1e6], // jenseits far (NDC z > 1 mit klarem Abstand)
      [3, 3, -3], // seitlich+oben draußen
    ] as const) {
      probe(new Vector3D(u, vv, w));
    }
  });

  it("is consistent across a deterministic depth sweep inside the volume (dual-space round-trip)", () => {
    const { frustum, ndc } = buildFrustum();
    let checked = 0;
    for (let depth = 1; depth <= 80; depth += 7) {
      for (const [u, v] of [
        [0, 0],
        [0.3, 0.2],
        [-0.4, -0.1],
      ] as const) {
        // Punkte strahlig im Kegel (innerhalb FOV), Tiefe gestaffelt — klar inside.
        const p = new Vector3D(u * depth * 0.4, v * depth * 0.4, -depth);
        const box = new BoundingBox(
          new Vector3D(p.x - PAD, p.y - PAD, p.z - PAD),
          new Vector3D(p.x + PAD, p.y + PAD, p.z + PAD),
        );
        const n = ndc(p);
        const ndcInside =
          n.x >= -1 &&
          n.x <= 1 &&
          n.y >= -1 &&
          n.y <= 1 &&
          n.z >= -1 &&
          n.z <= 1 &&
          Number.isFinite(n.x) &&
          Number.isFinite(n.y) &&
          Number.isFinite(n.z);
        expect(frustum.intersectsBox(box)).toBe(ndcInside);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });
});
