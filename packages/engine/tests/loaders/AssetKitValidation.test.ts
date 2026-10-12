import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";

interface KitManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  items: Array<{
    id: string;
    name: string;
    category: string;
    hazardClass?: string;
    path: string;
    preview: string;
    meta: string;
  }>;
  textures?: Array<{
    id: string;
    name: string;
    category: string;
    maps: string[];
  }>;
  decals?: Array<{
    id: string;
    name: string;
    file: string;
  }>;
  author: string;
  license: string;
}

interface PropMeta {
  id: string;
  name: string;
  category: string;
  kit: string;
  version: string;
  description: string;
  triangles: number;
  materials: number;
  textures: string[];
  dimensions: {
    width: number;
    height: number;
    depth: number;
  };
  recommendedScale: number;
  sockets?: Array<{
    name: string;
    position: [number, number, number];
    recommendedLight?: {
      type: string;
      color: string;
      intensity: number;
      distance: number;
    };
  }>;
  hazardClass?: string;
  author: string;
  license: string;
}

const kitsRootDir = path.resolve(process.cwd(), "public/assets/kits");

// The formal JSON Schemas own every shape/type/pattern constraint (required fields, `<kit>/<slug>`
// id pattern, enum-ish string patterns, the box-vs-cylinder `dimensions` oneOf). They cannot see
// across files, though -- cross-file cross-references (id equals directory name, item.meta
// resolves to a real file, meta.kit equals the owning manifest's id) stay as explicit assertions
// below instead of being fought into schema keywords no JSON Schema validator can express.
const schemasDir = path.resolve(process.cwd(), "public/schemas");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const kitSchema = JSON.parse(fs.readFileSync(path.join(schemasDir, "kit.schema.json"), "utf-8"));
const propMetaSchema = JSON.parse(
  fs.readFileSync(path.join(schemasDir, "prop-meta.schema.json"), "utf-8"),
);
const validateKit: ValidateFunction = ajv.compile(kitSchema);
const validatePropMeta: ValidateFunction = ajv.compile(propMetaSchema);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ADR 0011 §1.1 — 4-Tier Geometrie- & Polycount-Budget-Doktrin. Verbindlich für alle Kit-Props.
//
// Der formale Schema-Check oben kann keine Zahlenkreuzbeziehungen ausdrücken (Tier hängt von den
// Dimensions ab). Diese Blöcke übersetzen die Doktrin in harte Tests und lesen die WIRKLICHEN
// Dreieckszahlen direkt aus den GLB-Index-Accessoren (das `meta.triangles`-Feld der Tripo-Ausgabe
// lügt erfahrungsgemäß: meldet „12000", das GLB trägt in Wahrheit >1,4 Mio).
//
// Status laut ADR (2026-10-07): bestehende Original-Assets bleiben unverändert (grandfathered);
// die Doktrin gilt strikt für NEUE Props. Da die bestehende Flotte die Tier-Budgets in Summe
// übersteigt, wird sie gegen ihre gemessene Ist-Baseline (2026-10-11, per
// `.agents/scratches/audit-prop-budgets.mjs` ermittelt) geprüft: Regression verboten, keine
// harte Rückwirkung. Alle NICHT-grandfathered Props (ab jetzt) brechen hart bei Überschreitung.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const MAX_GLB_BYTES = 3 * 1024 * 1024; // ~1,2 MB Referenz laut ADR, Schranke großzügig

interface TierBudget {
  tier: string;
  maxL: number; // inklusive Obergrenze der Bounding-Box (m)
  maxTris: number;
}

// Inklusive Obergrenzen je Tier (ADR 0011 §1.1, Tabelle).
const TIER_BUDGETS: readonly TierBudget[] = [
  { tier: "T1", maxL: 0.35, maxTris: 1500 },
  { tier: "T2", maxL: 1.0, maxTris: 4500 },
  { tier: "T3", maxL: 2.5, maxTris: 10000 },
  { tier: "T4", maxL: Number.POSITIVE_INFINITY, maxTris: 16000 },
];

function tierBudgetFor(maxL: number): TierBudget {
  const budget = TIER_BUDGETS.find((b) => maxL <= b.maxL);
  if (!budget) throw new Error(`No tier budget for Lmax ${maxL}`);
  return budget;
}

/**
 * Liest die echte Dreieckszahl aus einem GLB (Summe über alle Index-Primitives). Liest nur den
 * JSON-Chunk, nicht den Binary-Chunk — bleibt damit auch für 40 MB-Assets schnell.
 */
function readGlbTriangleCount(glbPath: string): number {
  const b = fs.readFileSync(glbPath);
  const jsonLen = b.readUInt32LE(12);
  if (b.length < 20 + jsonLen) throw new Error(`GLB zu klein/unvollständig: ${glbPath}`);
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString()) as {
    accessors?: Array<{ count?: number }>;
    meshes?: Array<{ primitives?: Array<{ indices?: number }> }>;
  };
  let tris = 0;
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.indices != null) {
        const acc = json.accessors?.[prim.indices];
        if (acc?.count) tris += acc.count / 3;
      }
    }
  }
  return Math.round(tris);
}

// Grandfathered Ist-Baselines (gemessen 2026-10-11): id → { tris, bytes, tier }. Props, die die
// Tier-Budgets STRIKT erfüllen würden, brauchen keinen Eintrag — sie laufen ohnehin grün. Hier
// stehen nur die messbar Über-Budget-Assets, damit sie dokumentiert werden und ihre Baseline
// nicht regressiert.
interface LegacyBaseline {
  tris: number;
  bytes: number;
}
const GRANDFATHERED_BASELINES: Record<string, LegacyBaseline> = {
  "industrial/barrel_chemical_blue": { tris: 10337, bytes: 1243524 },
  "industrial/barrel_hazard_yellow": { tris: 9401, bytes: 1106412 },
  "industrial/barrel_oil_black": { tris: 10416, bytes: 1201256 },
  "industrial/wall_lamp": { tris: 11183, bytes: 1214388 },
  "bunker/coffee_grinder": { tris: 13955, bytes: 1420404 },
  "bunker/bunk_bed": { tris: 13057, bytes: 1570644 },
  "bunker/terminal_2100": { tris: 14143, bytes: 1775648 },
  "flakturm/debris_rubble_pile": { tris: 13453, bytes: 1567968 },
  "flakturm/bunker_blast_door": { tris: 13092, bytes: 1027688 },
  "flakturm/bunker_vent_hatch": { tris: 11356, bytes: 995216 },
  "flakturm/bunker_blast_door_leaf": { tris: 7593, bytes: 2231512 },
  "flakturm/ceiling_lamp": { tris: 1414382, bytes: 42776748 },
  "flakturm/vent_wall_breach": { tris: 1466018, bytes: 46578688 },
  "bunker/worn_rug": { tris: 1419192, bytes: 45862084 },
  "bunker/mess_tin_set": { tris: 1484142, bytes: 45659992 },
  "bunker/combat_boots": { tris: 1463204, bytes: 45569680 },
  "bunker/metal_desk": { tris: 1474454, bytes: 44589736 },
  "bunker/wall_shelf_supplies": { tris: 1414562, bytes: 44127964 },
  "bunker/kerosene_lantern": { tris: 1431926, bytes: 43914768 },
  "bunker/hanging_towels": { tris: 1425404, bytes: 43848436 },
  "bunker/metal_stool": { tris: 1386108, bytes: 41635080 },
};

function formatAjvErrors(validate: ValidateFunction): string {
  return JSON.stringify(validate.errors, null, 2);
}

// Every kit under `public/assets/kits/` must conform to the same schema (ADR 0011) — discovered
// dynamically so a new kit is validated automatically instead of silently drifting unnoticed the
// way `bunker`/`flakturm` did before this test covered them (they used `props`/`model` with no
// `meta` link, while only `industrial` — the one kit this test used to hardcode — matched the
// schema below).
const kitNames = fs
  .readdirSync(kitsRootDir, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && fs.existsSync(path.join(kitsRootDir, entry.name, "kit.json")),
  )
  .map((entry) => entry.name)
  .sort();

describe("Asset Kits & Metadata Standards (ADR 0011)", () => {
  it("finds at least one kit to validate", () => {
    expect(kitNames.length).toBeGreaterThan(0);
  });

  describe.each(kitNames)("kit: %s", (kitName) => {
    const kitDir = path.join(kitsRootDir, kitName);
    const manifest: KitManifest = JSON.parse(
      fs.readFileSync(path.join(kitDir, "kit.json"), "utf-8"),
    );

    it("conforms to kit.schema.json", () => {
      const valid = validateKit(manifest);
      expect(valid, formatAjvErrors(validateKit)).toBe(true);
    });

    it("its own $schema pointer resolves to the real schema file (not expressible in the schema itself)", () => {
      const raw = JSON.parse(fs.readFileSync(path.join(kitDir, "kit.json"), "utf-8")) as {
        $schema?: string;
      };
      expect(raw.$schema).toBeDefined();
      const resolved = path.resolve(kitDir, raw.$schema!);
      expect(fs.existsSync(resolved), `$schema does not resolve: ${raw.$schema}`).toBe(true);
      expect(resolved).toBe(path.join(schemasDir, "kit.schema.json"));
    });

    it("has a manifest whose id matches its directory name", () => {
      expect(manifest.id).toBe(kitName);
      expect(manifest.name.length).toBeGreaterThan(0);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.license.length).toBeGreaterThan(0);
      expect(manifest.author.length).toBeGreaterThan(0);
    });

    it("declares at least one item, texture, or decal", () => {
      const total =
        (manifest.items?.length ?? 0) +
        (manifest.textures?.length ?? 0) +
        (manifest.decals?.length ?? 0);
      expect(total).toBeGreaterThan(0);
    });

    it("every item's id is namespaced `<kit>/<slug>` and its path/preview/meta exist on disk", () => {
      for (const item of manifest.items ?? []) {
        expect(item.id).toBe(`${kitName}/${item.id.split("/").pop()}`);
        expect(item.id.startsWith(`${kitName}/`)).toBe(true);

        const glbPath = path.join(kitDir, item.path);
        const previewPath = path.join(kitDir, item.preview);
        const metaPath = path.join(kitDir, item.meta);

        expect(fs.existsSync(glbPath), `GLB model missing: ${item.path}`).toBe(true);
        expect(fs.existsSync(previewPath), `Preview missing: ${item.preview}`).toBe(true);
        expect(fs.existsSync(metaPath), `Meta JSON missing: ${item.meta}`).toBe(true);

        expect(fs.statSync(glbPath).size).toBeGreaterThan(10000);
        expect(fs.statSync(previewPath).size).toBeGreaterThan(1000);
      }
    });

    it("every item adheres to the ADR 0011 §1.1 4-Tier polycount doctrine (new assets: hard) and its grandfathered legacy baseline (existing: no regression)", () => {
      for (const item of manifest.items ?? []) {
        const meta: PropMeta = JSON.parse(fs.readFileSync(path.join(kitDir, item.meta), "utf-8"));
        const glbPath = path.join(kitDir, item.path);
        const fileBytes = fs.statSync(glbPath).size;
        const realTris = readGlbTriangleCount(glbPath);

        const dims = meta.dimensions as unknown as {
          width?: number;
          height: number;
          depth?: number;
          radius?: number;
        };
        // Box- (width/height/depth) oder Zylinder- (radius/height) Beschreibung; L_max ist die
        // größte physische Ausdehnung. (Die beiden Formen sind im Schema oneOf exklusiv.)
        const lMax =
          "radius" in dims
            ? Math.max((dims.radius ?? 0) * 2, dims.height)
            : Math.max(dims.width ?? 0, dims.height, dims.depth ?? 0);
        const budget = tierBudgetFor(lMax);
        const legacy = GRANDFATHERED_BASELINES[item.id];

        // Grandfathered Bestand: Baseline nicht überschreiten (Regression verhindern).
        if (legacy) {
          expect(
            realTris,
            `${item.id}: Treppe/-Tris ${realTris} über grandfathered Baseline ${legacy.tris} (ADR 0011 §1.1 Tier ${budget.tier} wäre ${budget.maxTris})`,
          ).toBeLessThanOrEqual(legacy.tris);
          expect(
            fileBytes,
            `${item.id}: GLB ${fileBytes}B über grandfathered Baseline ${legacy.bytes}B`,
          ).toBeLessThanOrEqual(legacy.bytes);
          continue;
        }

        // Neue Props: Doktrin HART.
        expect(
          realTris,
          `${item.id}: Tier ${budget.tier} (Lmax ${lMax.toFixed(2)}m) — ${realTris} Tris über Budget ${budget.maxTris} (ADR 0011 §1.1, '${budget.tier}' verbindlich für neue Props)`,
        ).toBeLessThanOrEqual(budget.maxTris);
        expect(
          fileBytes,
          `${item.id}: GLB ${fileBytes}B über Max ${MAX_GLB_BYTES}B (~1,2 MB Referenz laut ADR)`,
        ).toBeLessThanOrEqual(MAX_GLB_BYTES);
      }
    });

    it("every item's meta.json conforms to prop-meta.schema.json", () => {
      for (const item of manifest.items ?? []) {
        const meta: unknown = JSON.parse(fs.readFileSync(path.join(kitDir, item.meta), "utf-8"));
        const valid = validatePropMeta(meta);
        expect(valid, `${item.meta}: ${formatAjvErrors(validatePropMeta)}`).toBe(true);
      }
    });

    it("every item's meta.json cross-references its manifest entry (not expressible in a single-file schema)", () => {
      for (const item of manifest.items ?? []) {
        const meta: PropMeta = JSON.parse(fs.readFileSync(path.join(kitDir, item.meta), "utf-8"));
        expect(meta.id).toBe(item.id);
        expect(meta.kit).toBe(manifest.id);
      }
    });

    it("every item's meta.json $schema pointer resolves to the real schema file", () => {
      for (const item of manifest.items ?? []) {
        const metaDir = path.dirname(path.join(kitDir, item.meta));
        const raw = JSON.parse(fs.readFileSync(path.join(kitDir, item.meta), "utf-8")) as {
          $schema?: string;
        };
        expect(raw.$schema, `${item.meta} has no $schema`).toBeDefined();
        const resolved = path.resolve(metaDir, raw.$schema!);
        expect(
          fs.existsSync(resolved),
          `${item.meta}: $schema does not resolve: ${raw.$schema}`,
        ).toBe(true);
        expect(resolved).toBe(path.join(schemasDir, "prop-meta.schema.json"));
      }
    });

    it("every texture entry's id is namespaced and its maps exist on disk", () => {
      for (const tex of manifest.textures ?? []) {
        expect(tex.id.startsWith(`${kitName}/`)).toBe(true);
        const texDir = path.join(kitDir, "textures", tex.id.split("/").pop()!);
        for (const map of tex.maps) {
          expect(
            fs.existsSync(path.join(texDir, map)),
            `Texture map missing: ${tex.id}/${map}`,
          ).toBe(true);
        }
      }
    });

    it("every decal entry's id is namespaced and its file exists on disk", () => {
      for (const decal of manifest.decals ?? []) {
        expect(decal.id.startsWith(`${kitName}/`)).toBe(true);
        const decalPath = path.join(kitDir, "decals", decal.file);
        expect(fs.existsSync(decalPath), `Decal missing: ${decal.file}`).toBe(true);
      }
    });
  });

  // Kit-specific fixtures that go beyond the generic schema above.
  describe("industrial kit fixtures", () => {
    const industrialDir = path.join(kitsRootDir, "industrial");

    it("validates socket configuration on wall_lamp", () => {
      const metaPath = path.join(industrialDir, "wall_lamp/meta.json");
      const meta: PropMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

      expect(meta.sockets).toBeDefined();
      expect(meta.sockets!.length).toBeGreaterThanOrEqual(1);

      const lightBulbSocket = meta.sockets!.find((s) => s.name === "LightBulb");
      expect(lightBulbSocket).toBeDefined();
      expect(lightBulbSocket!.position).toEqual([0, 0, 0.18]);
      expect(lightBulbSocket!.recommendedLight?.type).toBe("PointLight");
      expect(lightBulbSocket!.recommendedLight?.intensity).toBe(3.8);
    });

    it("validates ADR / GHS hazard class labeling on barrels", () => {
      const hazardYellowMeta: PropMeta = JSON.parse(
        fs.readFileSync(path.join(industrialDir, "barrel_hazard_yellow/meta.json"), "utf-8"),
      );
      const chemBlueMeta: PropMeta = JSON.parse(
        fs.readFileSync(path.join(industrialDir, "barrel_chemical_blue/meta.json"), "utf-8"),
      );

      expect(hazardYellowMeta.hazardClass).toBe("ADR Class 6.1 (Toxic) / GHS06");
      expect(chemBlueMeta.hazardClass).toBe("ADR Class 3 (Flammable Liquid) / GHS02");
    });
  });
});
