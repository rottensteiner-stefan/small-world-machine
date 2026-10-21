# Scene Assembly & Asset-First Pipeline

Small World Machine utilizes an **asset-first, declarative scene assembly** workflow. Rather than scattering procedural placement logic, hard-coded offsets, or furniture instantiation loops in TypeScript code, environments are authored and loaded via declarative `*.level.json` files backed by a formal JSON schema.

---

## 1. Declarative Scene Authoring (`*.level.json`)

Scenes and rooms (e.g. game rooms, dioramas, narrative locations) are stored as declarative manifests.

### Level Manifest Structure

Every level manifest conforms to the engine's JSON Schema (`public/schemas/level.schema.json`):

```json
{
  "scene": "koje42",
  "items": [
    {
      "id": "bunker_bed_01",
      "kit": "flakturm",
      "reference": "bunker_bunk_bed",
      "position": [-1.2, 0.0, 1.8],
      "rotation": [0.0, 1.5708, 0.0],
      "scale": [1.0, 1.0, 1.0]
    },
    {
      "id": "decal_hazard_floor",
      "kit": "flakturm",
      "reference": "decal_hazard_stripes",
      "parent": "bunker_bed_01",
      "position": [0.0, 0.02, 0.5],
      "rotation": [1.5708, 0.0, 0.0],
      "scale": [1.2, 0.4, 0.1]
    }
  ]
}
```

### Core Schema Fields

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scene` | `string` | Yes | Identifier of the level / scene. |
| `items` | `Array<Item>` | Yes | List of prop instances, kits, lights, or decals in world space. |
| `items[].id` | `string` | Yes | Unique instance name within the scene. |
| `items[].kit` | `string` | Yes | Name of the asset kit (e.g. `flakturm`, `industrial`, `victorian`). |
| `items[].reference` | `string` | Yes | Identifier of the asset in the kit's manifest (`meta.json`). |
| `items[].position` | `[x, y, z]` | Yes | Placement coordinates (world space, or local to `parent` if defined). |
| `items[].rotation` | `[x, y, z]` | No | Euler rotation angles in radians (XYZ order). Defaults to `[0, 0, 0]`. |
| `items[].scale` | `[x, y, z]` | No | Scale factors along X, Y, Z. Defaults to `[1, 1, 1]`. |
| `items[].parent` | `string` | No | ID of another item to attach to hierarchically. |
| `items[].socket` | `string` | No | Named socket on the parent prop (requires `parent`). |

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
[`packages/engine/tests/loaders/LevelValidation.test.ts`](file:///packages/engine/tests/loaders/LevelValidation.test.ts) recursively scans the entire `apps/` tree and enforces:
1. **Schema Compliance:** Validates every level against `public/schemas/level.schema.json` via Ajv (Draft 2020-12).
2. **Kit & Prop Integrity:** Verifies that every referenced `kit` exists in `public/assets/kits/` and that the specified `reference` is registered in that kit's `meta.json`.
3. **Socket Veracity:** Ensures that any referenced `socket` actually exists on the parent prop.

If an asset is deleted, renamed, or misspelled, CI immediately rejects the commit.

---

## 4. Asset Quality & Kit Boundaries

When integrating external 3D models (from photogrammetry, artists, or generative AI such as Tripo3D):

### Discrepancies in Dimensions vs. Mesh Scale
External generation pipelines often write incorrect metadata bounds. For instance:
* A model's `meta.json` may state `1.8 × 2.2 × 0.25 m`, but the actual vertices of the root mesh render at `0.92 × 1.0 × 0.94 m`.
* **Remedy:** Always verify the visual fit against reference human-scale props (such as doorways, beds, or characters). If a prop is non-articulated (e.g. a static blast door), compensate via explicit scale in `*.level.json`. If articulation is needed, source or export a clean mesh with the origin at the hinge pivot.

### Projected Box Decals vs. Plane Overlays
Small World Machine supports hardware-accelerated **projected box decals** ([ADR 0029](/adr/0029-projected-box-decals), see [Decal Guide](./decals.md)):
* **Box Decals (`Decal`, `DecalMaterial`):** Project directly onto arbitrary opaque surfaces using the depth/normal buffer on WebGL2 and WebGPU.
* **Primitive Quad Workaround (WebGL1):** If targeting WebGL1 where MRT/depth sampling is unavailable, decals can fallback to a transparent quad (`Plane` + `StandardMaterial` with `transparent: true`, `diffuseMap = alphaMap`, `depthWrite = false`, `cullMode = NONE`).

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
