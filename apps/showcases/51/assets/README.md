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

### LOD siblings (`?reallod=1` path, showcase 51 field lane)

- Every tree base file `<stem>.glb` may have up to three generated siblings `<stem>_LOD1..3.glb`
  (`swm lod`, `packages/tools`; meshoptimizer ratios 0.5/0.2/0.08). **No `_LOD0.glb` is shipped**:
  LOD0 is by contract a byte-identical copy of the base file, and the showcase reuses the already
  loaded prototype as the finest bucket — shipping duplicates would waste LFS bytes.
- LOD GLBs: indexed TRIANGLES, POSITION/NORMAL/TEXCOORD_0 only (no COLOR_0/TANGENT — the engine
  regenerates tangents at runtime, asset-pipeline §T1); materials copied with texture refs
  stripped; `Uint32` indices. Loadable via the identical `GltfLoader` path as the base files.
- Field-lane consumer: URL `?reallod=1` (showcase 51, WebGPU) consumes the active prototype's
  `_LOD1..3` siblings atomically as a 4-bucket geometry chain (farthest bucket = `_LOD3`); any
  missing/invalid sibling fails closed to the proxy path. **Default = stride-decimation proxies**
  (see §3): on this stylized low-poly set the simplifier honestly fails soft, so real LODs barely
  reduce triangles and the proxies stay the better far-bucket strategy (opt-in knob only).

### Mesh access & transforms

- **Kenney kit GLBs:** scene root `> tmpParent (identity) > "<model>" node with mesh`. The mesh-bearing Object3D is `root.children[0].children[0]` (traverse `root` to find it deterministically). The inner node may carry a small `translation` (e.g. `(0,-0.05,0)`). **Position/rotate/scale the returned root object, never the inner node.** Pivot = ground contact (`y≈0`).
- **Card GLBs:** mesh + material sit on `root.children[0]` directly (single node). Pivot = ground contact (`y=0` at the base) for upright cards; `leaf_pile` is a flat card centered on origin, place with `y≈0.02` above terrain.
- Orientation: Y-up, right-handed (engine convention). Models face +Z / none are directional; yaw randomly around Y for scattering.

## 3. Asset list & per-file stats

### Trees — 3 species + generated `_LOD<n>` siblings (baked via `swm lod`, P2-3)

| File | Form | Tris | Verts | Notes |
|---|---|---|---|---|
| `tree_pineTallA.glb` | conifer, tall | 78 | 272 | silhouette-A conifer (LOD0 base) |
| `tree_pineTallA_LOD1.glb` | — | 78 | 136 | pass-through (−0 %) |
| `tree_pineTallA_LOD2.glb` | — | 74 | 133 | −5 % |
| `tree_pineTallA_LOD3.glb` | — | 74 | 133 | −5 % (fail-soft floor) |
| `tree_oak.glb` | broadleaf, round crown | 196 | 648 | silhouette-B (LOD0 base) |
| `tree_oak_LOD1.glb` | — | 196 | 324 | pass-through (−0 %) |
| `tree_oak_LOD2.glb` | — | 193 | 321 | −1.5 % |
| `tree_oak_LOD3.glb` | — | 192 | 320 | −2 % (fail-soft floor) |
| `tree_detailed.glb` | leafy, dense crown | 402 | 2274 | highest tri tree (LOD0 base) |
| `tree_detailed_LOD1.glb` | — | 398 | 754 | −1 % |
| `tree_detailed_LOD2.glb` | — | 392 | 748 | −2.5 % |
| `tree_detailed_LOD3.glb` | — | 380 | 740 | −5.5 % (fail-soft floor) |

**Measured reality (P2-3, 2026-11-10):** the simplifier fails soft on this stylized low-poly set —
LOD3 reaches only −2…−5.5 % instead of the −92 % requested by ratio 0.08; even `--error 0.5`
unlocks almost nothing. The engine-side stride-decimation far-bucket proxy (~−66 %) therefore
stays the DEFAULT; `?reallod=1` exists as the real-consumption opt-in and pays off only for
organic/high-poly assets (see `docs/guides/asset-pipeline.md` §6 + `docs/adr/0059`).

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

- **Verified:** GLB container validity (magic/version/chunk layout), JSON sanity, accessor/index/buffer-view integrity; engine-side parse of **all 21 base files** through `GltfLoader` (geometry + meshes + materials; cards resolve their embedded WebP into `diffuseMap`; Kenney files parse as lit, metallic=0). See scratch suite `.agents/scratches/veg-assets-parse.test.ts`.
- **LOD siblings verified (P2-3 CLI):** every `_LOD1..3.glb` re-parsed by the CLI `--verify` (structure-valid) plus byte-identical determinism; LOD0 == base file by contract (not shipped). Field-lane runtime consumption of the siblings (`?reallod=1`) is the showcase-51 runtime gate (headless SwiftShader, 2026-11-10).
- **Not verified (browser/GPU):** actual WebP decode via `createImageBitmap` runs only in a browser; card cutout rendering on all three renderers is Erin/Charly's runtime gate (showcase 51).
- Builder scripts: `.agents/scratches/glb-cards.mjs`, `.agents/scratches/glb-normalize.mjs`, `.agents/scratches/gen-manifest.mjs` (scratch, not committed).
