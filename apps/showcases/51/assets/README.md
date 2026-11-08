# Showcase 51 — Vegetation Assets (P0 baseline)

Owned by Frank (T2, veg-p0). Loaded by Erin (T3, showcase scatter). Provenance per file:
`MANIFEST.json` (sha256, bytes, tris, verts, alpha mode). License texts: `LICENSE-kenney-nature-kit.txt`, `LICENSE-kenney-foliage-sprites.txt`.

## 1. License & provenance (CC0, verified)

- All assets are **CC0** (Creative Commons Zero 1.0). Verbatim license texts shipped in this folder.
- **Kenney — Nature Kit v2.1** (2020-04-29, `kenney_nature-kit.zip`, 36 MB downloaded): `Models/GLTF format/*.glb`. Download: https://kenney.nl/assets/nature-kit (page, license CC0).
- **Kenney — Foliage Sprites** (2020-02-08, `kenney_foliage-sprites.zip`): `PNG/Flat/sprite_*.png` source textures for the alpha-cutout cards. Download: https://kenney.nl/assets/foliage-sprites (CC0).
- **Originals duty (ADR 0058):** raw zips are NOT in git. Keep them on Google Drive. Checksums of the original downloads:
  - `kenney_nature-kit.zip` sha256 `fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d`
  - `kenney_foliage-sprites.zip` sha256 `8e3e944acaa731a90e0b004846d2ce99ee8a65d5479b4c2f421cab7cdde128e5`
  - `kenney_foliage-pack.zip` (unused after evaluation) sha256 `33bd564f2cebb6a68bee9a798650d669571a389a437b0bd601d257ca2b5e7aed`

## 2. Loading contract (engine, all tiers)

Load every file with the engine loader:

```ts
import { GltfLoader } from "@small-world-machine/engine";
const loader = new GltfLoader({ basePath: "./assets/" });
const root = await loader.load("tree_oak.glb");
```

- Files are **core glTF 2.0 GLB, uncompressed, no Draco/KTX2** → deterministic measurement (ADR 0059 step 0).
- Kenney kit files: keep the `extensionsUsed: KHR_materials_unlit` marker — it is *declared file-level only, not per-material* → the engine parses them as **PBR-lit** (unlit flag not set). `metallicFactor` normalized to `0` for matte lit props (source shipped `metallic=1` = bare metal look). Roughness `1`.
- Card files: use alphaMode `MASK` (cutout, opaque batch + discard per asset-pipeline C-section) + `doubleSided`. Textures are **WebP embedded via `EXT_texture_webp`** (engine-internal extension, supported by `GltfLoader`). No external texture files exist.

### Mesh access & transforms

- **Kenney kit GLBs:** scene root `> tmpParent (identity) > "<model>" node with mesh`. The mesh-bearing Object3D is `root.children[0].children[0]` (traverse `root` to find it deterministically). The inner node may carry a small `translation` (e.g. `(0,-0.05,0)`). **Position/rotate/scale the returned root object, never the inner node.** Pivot = ground contact (`y≈0`).
- **Card GLBs:** mesh + material sit on `root.children[0]` directly (single node). Pivot = ground contact (`y=0` at the base) for upright cards; `leaf_pile` is a flat card centered on origin, place with `y≈0.02` above terrain.
- Orientation: Y-up, right-handed (engine convention). Models face +Z / none are directional; yaw randomly around Y for scattering.

## 3. Asset list & per-file stats

### Trees — 3 species, LOD0 (no LOD chain in source; P2 `swm lod` will bake LODs)

| File | Form | Tris | Notes |
|---|---|---|---|
| `tree_pineTallA.glb` | conifer, tall | 78 | use as silhouette-A conifer |
| `tree_oak.glb` | broadleaf, round crown | 196 | use as silhouette-B |
| `tree_detailed.glb` | leafy, dense crown | 402 | highest tri tree, use sparingly |

### Ground cover — low-poly opaque tufts (dominant population)

| File | Tris | Notes |
|---|---|---|
| `grass.glb` | 132 | grass tuft |
| `grass_large.glb` | 224 | larger tuft |
| `grass_leafs.glb` | 36 | small leaf/bushlet tuft |
| `flower_yellowA.glb` / `flower_redA.glb` / `flower_purpleA.glb` | 76 each | flowers (species = colour) |

### Forest-floor debris

| File | Tris | Notes |
|---|---|---|
| `log.glb` / `log_large.glb` / `log_stack.glb` | 200 / 96 / 184 | fallen wood |
| `rock_smallA.glb` / `rock_smallFlatA.glb` | 16 / 20 | pebbles |
| `mushroom_red.glb` / `mushroom_tan.glb` | 48 / 48 | ground fungi |
| `tree_pineGroundA.glb` | 82 | wrecked/stump pine (large debris) |

### Alpha-cutout cards (self-built from CC0 Kenney sprites, WebP embedded)

| File | Tris | Size (m) | Notes |
|---|---|---|---|
| `card_grass.glb` | 4 (2 crossed quads) | 0.55 h | grass tuft card, cutout |
| `card_flower_a.glb` | 4 (2 crossed quads) | 0.50 h | wildflower card, cutout |
| `card_bush.glb` | 4 (2 crossed quads) | 0.60 h | bush card, cutout |
| `leaf_pile.glb` | 2 (1 flat quad) | 0.9 × 0.9 | ground leaf litter card, cutout, nearly flat |

## 4. Scatter guidance for the baseline (P0)

- Dominant population per ADR 0059 step 0 = ground cover (grass + flowers + debris cards). Budget per prototype:
  trees 78–402 tris, tufts ≤ 224 tris, cards 2–4 tris — all **below** asset-pipeline Tier 1 budgets; trivially fits the ≥250 k instance field target.
- For equal basis between `?mode=` baselines use **one species set** for all runs (seeded scatter); the cards are the only alpha-cutout prototypes (`?n=`-independent, deterministic geometry).
- Card cutout note: `alphaMode MASK` needs mip-backed alpha for distance (C5); for P0 baseline the cards are near-field only — that is fine, Erin decides the ring.
- Do not scale cards below ~0.7× or the cutout texel density collapses (512² textures); uniform scale only.

## 5. Verification status (honest)

- **Verified:** GLB container validity (magic/version/chunk layout), JSON sanity, accessor/index/buffer-view integrity; engine-side parse of **all 21 files** through `GltfLoader` (geometry + meshes + materials; cards resolve their embedded WebP into `diffuseMap`; Kenney files parse as lit, metallic=0). See scratch suite `.agents/scratches/veg-assets-parse.test.ts`.
- **Not verified (browser/GPU):** actual WebP decode via `createImageBitmap` runs only in a browser; card cutout rendering on all three renderers is Erin/Charly's runtime gate (showcase 51). No compute, no instancing, no LODs in this batch by design.
- Builder scripts: `.agents/scratches/glb-cards.mjs`, `.agents/scratches/glb-normalize.mjs`, `.agents/scratches/gen-manifest.mjs` (scratch, not committed).
