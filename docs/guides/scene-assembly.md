# Scene Assembly & Asset-First Pipeline

Small World Machine utilizes an **asset-first, declarative scene assembly** workflow. Rather than scattering procedural placement logic, hard-coded offsets, or furniture instantiation loops in TypeScript code, environments are authored and loaded via declarative `*.level.json` files backed by a formal JSON schema.

---

## 1. Declarative Scene Authoring (`*.level.json`)

Scenes and rooms (e.g. game rooms, dioramas, narrative locations) are stored as declarative manifests.

### Level Manifest Structure

Every level manifest conforms to the engine's JSON Schema (`public/schemas/level.schema.json`):

```json
{
  "$schema": "../../../../../public/schemas/level.schema.json",
  "id": "koje_42",
  "name": "Bunker Koje 42 Arenberg",
  "version": "1.0.0",
  "props": [
    {
      "id": "MetalDesk",
      "kitProp": "bunker/metal_desk",
      "position": [-0.75, 0.403, -0.982],
      "rotation": [0, 1.570796, 0],
      "scale": 1.2,
      "materialOverrides": { "roughness": 0.75, "metallic": 0.45 }
    }
  ],
  "decals": [
    {
      "id": "Decal_Koje42Sign",
      "kitDecal": "flakturm/sign_koje42",
      "position": [-2.34, 1.75, 1.0],
      "rotation": [1.570796, 1.570796, 0]
    }
  ]
}
```

A complete real example: `apps/sample-apps/the-whisper/scenes/prologue/koje42.level.json`.

### Core Schema Fields

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `id` | `string` | Yes | Identifier of the level / scene. |
| `name` | `string` | Yes | Display name. |
| `version` | `string` | Yes | Semver version of the manifest. |
| `description` | `string` | No | Free-text description. |
| `props` | `Array<PropPlacement>` | Yes | Kit prop instances. |
| `decals` | `Array<DecalPlacement>` | No | Projected decals (see [Decals](./decals.md)). |
| `lights` | `Array<Light>` | No | Scene lights. |
| `hotspots` | `Array<Hotspot>` | No | Interaction hotspots. |
| `environment` | `object` | No | Environment settings, e.g. `surfaces[]`. |
| `stageZone` | `object` | No | 2.5D walkable zone. |
| `props[].id` | `string` | Yes | Unique instance name within the scene. |
| `props[].kitProp` | `string` | Yes | `"<kit>/<prop>"`, e.g. `bunker/metal_desk`; resolved through the kit's `kit.json`. |
| `props[].position` | `[x, y, z]` | Yes | World-space placement. |
| `props[].rotation` | `[x, y, z]` | No | Euler angles in radians (XYZ). |
| `props[].scale` | `number` | No | Uniform scale factor. |
| `props[].lightOverrides` / `materialOverrides` | `object` | No | Per-instance overrides of the prop's lights / materials. |
| `decals[].kitDecal` | `string` | Yes | `"<kit>/<decal>"`, e.g. `flakturm/sign_koje42`. |
| `decals[].parent` | `string` | No | ID of a prop to attach the decal to. |
| `decals[].socket` | `string` | No | Named socket on the parent prop (requires `parent`). |

The authoritative field list (including `size`, `fade`, `opacity`, `priority`, `tags` on decals) is `$defs` in `public/schemas/level.schema.json`.

---

## 2. Runtime Loading Contract: The Vite URL Rule

When loading a level manifest in an application or showcase:

> [!IMPORTANT]
> **Always resolve URLs using `import.meta.url`:**
> ```typescript
> const levelUrl = new URL("./koje42.level.json", import.meta.url);
> const response = await fetch(levelUrl);
> const levelData = await response.json();
> ```
>
> **Never use root-relative or absolute strings** like `fetch("/scenes/prologue/koje42.level.json")`.
> While absolute paths may accidentally work in local dev mode under certain server configs, Vite's production rollup bundler hashes and relocates assets, leading to silent **HTTP 404 errors** in preview and production builds.

---

## 3. Automated Validation & CI Gating

Small World Machine guarantees the integrity of all level files through automated CI tests.

### Directory Location Rule
All `*.level.json` files **must reside under `apps/`** (e.g. `apps/sample-apps/the-whisper/scenes/prologue/`).

### Test Coverage
`packages/engine/tests/loaders/LevelValidation.test.ts` recursively scans the entire `apps/` tree and enforces:
1. **Schema Compliance:** Validates every level against `public/schemas/level.schema.json` via Ajv (Draft 2020-12).
2. **Kit & Prop Integrity:** Verifies that every `kitProp` is registered in its kit's `kit.json` and that the referenced `meta` file exists.
3. **Decal Integrity:** Verifies every `kitDecal` including its map files (`file`/`normal`/`orm`/`emission` under `decals/`), that a decal's `parent` is a prop ID, and that a `socket` exists in the parent's `meta.sockets`.

If an asset is deleted, renamed, or misspelled, CI immediately rejects the commit.

---

## 4. Asset Quality & Kit Boundaries

When integrating external 3D models (from photogrammetry, artists, or generative AI such as Tripo3D):

### Discrepancies in Dimensions vs. Mesh Scale
External generation pipelines often write incorrect metadata bounds. For instance:
* A model's `meta.json` (per-prop metadata; the kit manifest itself is `kit.json`) may state `1.8 × 2.2 × 0.25 m`, but the actual vertices of the root mesh render at `0.92 × 1.0 × 0.94 m`.
* **Remedy:** Always verify the visual fit against reference human-scale props (such as doorways, beds, or characters). If a prop is non-articulated (e.g. a static blast door), compensate via explicit scale in `*.level.json`. If articulation is needed, source or export a clean mesh with the origin at the hinge pivot.

### Projected Box Decals vs. Plane Overlays
Small World Machine supports hardware-accelerated **projected box decals** ([ADR 0029](/adr/0029-decal-system), see [Decal Guide](./decals.md)):
* **Box Decals (`Decal`, `DecalMaterial`):** Project directly onto arbitrary opaque surfaces using the depth/normal buffer on WebGL2 and WebGPU.
* **WebGL1:** Where MRT/depth sampling is unavailable, decals can be baked into meshes (`bakeDecalMesh` / `bakeSceneDecals`, see [Decal Guide](./decals.md)) or fall back to a transparent quad (`Plane` + `StandardMaterial` with `transparent: true`, `diffuseMap = alphaMap`, `depthWrite = false`, `cullMode = NONE`).

### Coordinate System & Primitive Orientation
Remember the engine's core coordinate system:
* **Right-handed system:** `+X = Right`, `+Y = Up`, `+Z = Backward` (`-Z = Forward`).
* **`Plane` Primitive:** Generated in the local XY plane, facing `+Z`.
  * Facing `+X`: `rotation.y = Math.PI / 2`
  * Facing `+Y` (floor/horizontal): `rotation.x = -Math.PI / 2`

---

## 5. Interactive Debugging & Inspection

In development builds:
* Expose the live scene on `window` for console inspection (e.g. `(window as any).__scene = scene`).
* Use **The Forge** (`attachDevTools(app)`) to inspect scene graphs, octree bounding boxes, active lights, and camera frustums in real time.
