# Maker (World & Scene Editor) — Pro Guide & Reference

**Maker** is Small World Machine's standalone, browser-based 3D scene and environment editor (`/tools/maker.html`). Built specifically for digital artists and power users, Maker closes the gap between procedural engine development and visual scene composition — no more hand-written scene layout files, just a low-latency, keyboard-driven workflow.

```
+-------------------------------------------------------------------------------------------------------+
|  Header: [Maker - Small World Machine]   [📷1][📷2]..[📷9]   [🧲 0.50m][[][]]   [⬇ Floor]   [Save/Status]      |
+-------------------+---------------------------------------------------------------+-------------------+
| Hierarchy & Add   | Viewport & interactive tools                                  | Inspector         |
| - Scene tree      | - Orbit camera & 9 quick view bookmarks (1-9 / Ctrl+1-9)      | - Transform       |
| - Primitives      | - Always-on-top transform gizmo (W: Move / E: Rotate / R: Sc) |   (X/Y/Z nudge)   |
| - Lights          | - Camera-cardinal keyboard nudging (arrows / PageUp/Down)     | - Materials (PBR) |
| - Prefabs (thumb) | - Dynamic snapping (0.1m - 2.0m / 15° / 0.25)                 |   (Rough/Metal/α) |
| - ASCII map import| - 2D marquee selection & cyan/amber cluster highlighting      | - Behaviors       |
|                   | - Pivot-relative multi-object group transforms                |   (factory batch) |
+-------------------+---------------------------------------------------------------+-------------------+
| Footer: Autosave status (all changes saved to scene.gltf / 500ms debounce)                             |
+-------------------------------------------------------------------------------------------------------+
```

---

## 1. Power-user ergonomics & fast keyboard nudging

Maker is built around a "hands on the keyboard" philosophy, heavily inspired by professional digital-art and 3D-modeling packages (Blender, Photoshop, Unreal Engine).

### Camera-cardinal directional nudging
Moving objects via the arrow keys is **camera-perspective-aware**:
- **XZ-plane ground movement:** pressing $\uparrow$, $\downarrow$, $\leftarrow$, or $\rightarrow$ computes the camera's dominant cardinal orientation in world space in real time (North, East, South, West).
  - $\uparrow$ always moves the selection **away from the viewer** (into image depth).
  - $\downarrow$ always moves the selection **toward the viewer**.
  - $\rightarrow$ always moves the selection **visually to the right**.
  - $\leftarrow$ always moves the selection **visually to the left**.
- **Height movement (Y axis):**
  - `Shift` + $\uparrow$ or `Page Up`: moves selected objects by the active grid snap increment **upward (+Y)**.
  - `Shift` + $\downarrow$ or `Page Down`: moves selected objects by the active grid snap increment **downward (-Y)**.

### Modal transform hotkeys
The arrow keys adapt dynamically to the active gizmo mode or keyboard modifier:
| Mode / modifier | Arrow key action | Step size |
|---|---|---|
| **Move mode (<kbd>W</kbd>)** (default) | Shift position (XZ / Y with Shift) | Current grid snap (`0.1m` – `2.0m`) |
| **Rotate mode (<kbd>E</kbd>)** or <kbd>Alt + arrows</kbd> | Rotate yaw (Y) / pitch (X) | Angle snap ($15^\circ$ / $\pi / 12$) |
| **Scale mode (<kbd>R</kbd>)** or <kbd>Alt + Shift + arrows</kbd> | Scale object (uniform / axis) | Scale snap ($0.25$) |
| **Decal stamp mode (<kbd>D</kbd>)** | <kbd>R</kbd> / <kbd>Shift+R</kbd> spin the stamp about the surface normal; arrows nudge in the surface plane; <kbd>Shift</kbd> + arrows scale the stamp; <kbd>Esc</kbd> leaves | $15^\circ$ / grid snap / scale snap |

While the stamp mode is on, <kbd>R</kbd> belongs to the stamp (it is the Scale gizmo again as soon as you leave the mode).

### Decal stamp mode (<kbd>D</kbd>)
Double-click a decal in the Content Drawer's *Decals* pill (or press <kbd>D</kbd> or the `Stamp Decal` button after that) to arm the tool: a semi-transparent ghost decal follows the mouse over the surface (scene geometry, otherwise the $Y = 0$ floor), its local +Y on the surface normal. A left click stamps the decal there as one undo step; the mode stays on for the next stamp, <kbd>Esc</kbd> or <kbd>D</kbd> leaves it. <kbd>R</kbd> / <kbd>Shift+R</kbd> spin the stamp by $15^\circ$ about the normal (kept between stamps), the arrow keys nudge it in the surface plane by the grid snap (the nudge resets when the mouse moves), <kbd>Shift</kbd> + arrows scale it uniformly by the scale snap. Stamped decals are saved in `scene.gltf` (`SWM_decal`) and get their textures back on reload. <kbd>Ctrl/Cmd+D</kbd> stays Duplicate.

Limitation: decals are not raycast targets, so a click in the viewport cannot select a stamped decal; select it in the hierarchy panel (the inspector then offers priority, opacity, edge fade and angle fade).

### Snap to floor (<kbd>End</kbd> / `⬇ Floor`)
Pressing <kbd>End</kbd> (or clicking `⬇ Floor`) computes the exact lower world-space bounding-box bound (`min.y`) for the entire current selection (single object or multi-selection cluster) and moves it vertically so its bottom edge sits exactly flush with `Y = 0` (the world floor plane).

---

## 2. Dynamic snapping system & grid-resolution stepping

Snapping is **enabled by default** in Maker, to ensure clean, modular scene construction without microscopic gaps or misalignments.

- **Instant toggle:** press <kbd>X</kbd> or click `🧲 Snap` to toggle snapping on/off on the fly.
- **Quick grid-stepping hotkeys:**
  - <kbd>[</kbd>: **Finer grid** — steps down through resolutions (`2.0m` $\rightarrow$ `1.0m` $\rightarrow$ `0.5m` $\rightarrow$ `0.25m` $\rightarrow$ `0.1m`).
  - <kbd>]</kbd>: **Coarser grid** — steps up through resolutions (`0.1m` $\rightarrow$ `0.25m` $\rightarrow$ `0.5m` $\rightarrow$ `1.0m` $\rightarrow$ `2.0m`).
- **Precision parameters:**
  - **Translation snap:** default `0.5m` (adjustable from `0.1m` to `2.0m`).
  - **Rotation snap:** fixed $15^\circ$ ($0.2618\text{ rad}$) angle quantization.
  - **Scale snap:** fixed `0.25` step multiples.

---

## 3. Multi-selection, marquee selection & pivot-relative clusters

Maker supports full multi-object workflows with full parity between viewport and hierarchy interactions.

```
                    [Primary: cyan wireframe] (active inspector & pivot anchor)
                              |
                              +--- [Secondary: amber wireframe]
                              +--- [Secondary: amber wireframe]
```

### Selection mechanics
- **Single selection:** left-click an object in the viewport or click a row in the hierarchy panel.
- **Additive multi-selection:** hold <kbd>Shift</kbd>, <kbd>Ctrl</kbd>, or <kbd>Cmd</kbd> while clicking objects in the viewport or rows in the hierarchy panel to add/remove them from the selection set.
- **2D marquee selection:** click and drag over an empty area of the viewport to draw a 2D marquee box (`.maker-marquee-box`). Maker projects all scene-object bounding volumes through the camera's view-projection matrix into screen space to select everything inside the box. Hold <kbd>Shift</kbd> while dragging to extend the current selection additively.

### Primary vs. secondary objects
- **Primary object (cyan highlight):** the main anchor of the selection. It determines what appears in the property inspector, and serves as the 3D center pivot for gizmo transforms.
- **Secondary objects (amber highlight):** further members of the multi-selection cluster.

### Pivot-relative cluster transforms
When rotating or scaling a multi-selection with the gizmo, transforms are performed **relative to the primary object's world-space pivot point** — this keeps the cluster's spatial relationships intact, instead of rotating each object around its own local axis.

### Batch operations
- **Batch duplicate (<kbd>Ctrl+D</kbd>):** deep-clones all selected objects, material properties, and attached behaviors, offsets them cleanly in the scene, and wraps this in a single undo transaction.
- **Batch delete (<kbd>Del</kbd> / <kbd>Backspace</kbd>):** moves all selected objects into the soft-delete trash bin in a reversible step.
- **Batch grouping (<kbd>Ctrl+G</kbd>):** computes the 3D centroid of all selected objects, creates a new parent `Object3D` group at that centroid, and reparents the children under it while preserving their exact world matrices.
- **Batch behaviors:** adding a behavior from the palette automatically instantiates and attaches fresh, isolated behavior instances to all selected objects in one atomic operation.

---

## 4. Always-on-top transform gizmo

The Maker transform gizmo provides standard **translation** (<kbd>W</kbd>), **rotation** (<kbd>E</kbd>), and **scaling** (<kbd>R</kbd>) directly in the 3D viewport.

- **Occlusion-proof rendering:** rendered with `depthTest: false` and `depthWrite: false`, so transform handles, rotation rings, and scale boxes stay fully visible even when objects are positioned inside dense geometry or behind large meshes.
- **Interactive highlighting:** handles highlight on hover and snap to active drag axes.
- **Dynamic alignment:** stays anchored to the world position of the primary selected object.

---

## 5. 3D light gizmos & selection range volumes

Abstract scene emitters (`PointLight`, `DirectionalLight`, `SpotLight`, `AmbientLight`) have dedicated, industry-standard visual markers in the 3D viewport:

- **Pickable visual glyphs (billboards):**
  - 💡 **PointLight:** glowing octahedron core in `light.color` (or yellow). Always billboarded to face the camera.
  - ☀️ **DirectionalLight:** sun disc with a direction arrow showing the light angle.
  - 🔦 **SpotLight:** mini emitter cone along the spotlight's target vector.
  - 🌐 **AmbientLight:** wireframe sphere representing the sky's ambient lighting.
- **Direct 3D raycasting:** clicking a light glyph in the 3D viewport selects the light, attaches the transform gizmo, and opens its properties (`Color`, `Intensity`, `Distance`, `Decay`, `Angle`) in the property inspector.
- **Dynamic selection range volumes:**
  - When a `PointLight` is selected, Maker draws a wireframe sphere showing its falloff range (`distance`).
  - When a `SpotLight` is selected, Maker renders a wireframe cone showing its exact cone angle (`angle`) and range (`distance`). Adjusting the parameters in the inspector scales the visual cone in real time!
- **No export overhead:** all light helper objects live in an isolated, editor-only container and are automatically excluded from scene saves and runtime builds.

---

## 6. Prefab pipeline & isolated 3D thumbnail renders

Maker provides a complete, self-contained pipeline for creating and placing prefabs.

```
[Hierarchy selection] ---> [Save prefab] ---> 1. Isolate object subtree
                                              2. Reframe to 3/4 camera angle
                                              3. Render isolated thumbnail (.thumb.json)
                                              4. Save glTF scene graph (.gltf)
```

1. **Creating prefabs:** select any object or a grouped hierarchy in the scene, type a prefab name in the prefab palette, and click **Save Selection**.
2. **Automated isolated thumbnail generation:**
   - Maker temporarily hides the transform gizmo, highlight boxes, and all unrelated scene objects, while keeping scene lighting (`AbstractLight`) intact.
   - Recursively computes the bounding sphere of the prefab subtree.
   - Automatically positions the snapshot camera at an optimal $3/4$ isometric angle `(1, 0.75, 1)`, tightly framed around the object.
   - Captures an offscreen render into an accompanying thumbnail (`prefabs/<name>.thumb.json`).
   - Fully restores viewport camera, orbit-controller state, and scene visibility without interrupting the user.
3. **Prefab placement:** clicking any prefab thumbnail or name in the prefab palette places a fresh instance directly at the viewport focus center in the scene.

---

## 7. Camera bookmarks & viewport navigation

### 9 instant session bookmarks (<kbd>1</kbd>–<kbd>9</kbd> & <kbd>Ctrl+1</kbd>–<kbd>9</kbd>)
- **Recall view:** press number keys <kbd>1</kbd> through <kbd>9</kbd> (or click the toolbar buttons `📷1`–`📷9`) to instantly animate the camera to a saved viewpoint.
- **Save view:** press <kbd>Ctrl+1</kbd> through <kbd>Ctrl+9</kbd> (or **right-click** a bookmark button `📷1`–`📷9`) to save the current camera position, pitch, yaw, and orbit target into that slot. Slots with saved views are highlighted with an active border.

### Multi-button mouse navigation (orbit & pan)
- **Rotate view (orbit):** right-click + drag, middle-click + drag, <kbd>Alt</kbd> + left-drag, or macOS <kbd>Ctrl</kbd> + left-drag.
- **Pan view:** <kbd>Shift</kbd> + right-/middle-drag.
- **Zoom view:** mouse wheel or <kbd>Ctrl</kbd> + mouse wheel.
- **Scroll-zoom decoupling:** scrolling inside the hierarchy, object palette, or property inspector is strictly isolated (`stopPropagation()`), preventing unintended viewport zooming while navigating long UI lists.

---

## 8. ASCII level & dungeon map import

Maker includes a built-in ASCII tilemap converter (`MapImportPanel.ts`) for quick retro level design and dungeon blocking, feeding `GridLevelBuilder` through Maker's own default legend (`AsciiMapLegend.ts`) — deliberately its own small palette rather than an import of the `MapGenerator` tool's internal palette, though it reuses the same characters/colors so a map painted in `MapGenerator` still looks recognizable once imported:

```
ASCII source:              3D world generation:
##########                 W / G -> Wall block (2m tall)
#.P...+...E#               .     -> Floor tile (implicit, no marker)
#..b.......#               +     -> Door marker
##########                  P     -> Player-start marker
                            E     -> Enemy marker
                            b     -> Barrel marker
                            l     -> Torch marker
                            T     -> Lava marker
                            ~     -> Slime marker
                            I     -> Item marker
                            O     -> Secret marker
```

Paste your text layout into the ASCII import dialog to instantly generate a 3D level with aligned wall blocks, floor tiles, and marker cubes for doors, enemies, items, and the player start — a fast, editable base to refine by hand afterward in Maker, not a finished level.

---

## 9. Persistence & the glTF 2.0 `SWM_*` extension engine

Maker uses the browser's native **File System Access API** (`showDirectoryPicker`) for direct local workspace binding, without uploading data to external servers.

- **Frictionless autosave:** every edit (transform change, color adjustment, hierarchy reorder, prefab creation) triggers a debounced (~500ms) write-through directly to `scene.gltf`.
- **`SWM_*` glTF metadata extensions:** non-standard engine data is stored cleanly in glTF 2.0's `extensions` vendor namespace via a pluggable extension registry (see `docs/adr/0017-gltf-extension-plugin-registry.md`). Currently implemented:
  - `SWM_prefab_instance`: provenance-only record of which Maker prefab a node was instantiated from.
  - `SWM_stage_zone`: a 2.5D `StageZone`'s points and display name (see `docs/adr/0016-2-5d-stage-zones-as-a-gltf-extension.md`), giving it a scene-graph presence via `StageZoneMarker`.
  - A node's material is written through native glTF `pbrMetallicRoughness` rather than a custom extension, since `StandardMaterial`'s fields map onto it directly. Behaviors and physics data are not currently round-tripped through the glTF file (`WorldWriter`'s scope is still Phase 0: hierarchy, transforms, one material per mesh, and position-only geometry).
- **Portability:** the generated `scene.gltf` files can be opened directly in Blender, Babylon.js, Three.js, or loaded straight into the Small World Machine game runtime via `GltfLoader`.

---

## 10. Non-destructive undo/redo & soft-delete engine

All scene mutations are tracked on an atomic `UndoStack`:
- **Undo / redo:** <kbd>Ctrl+Z</kbd> to undo, <kbd>Ctrl+Shift+Z</kbd> (or <kbd>Ctrl+Y</kbd>) to redo.
- **Soft-delete architecture:** deleting an object or hierarchy branch moves it into a scene-external `_trashBin` container instead of immediately releasing its WebGL/WebGPU buffers. This guarantees instant, stutter-free restoration on undo without GPU hitching.

---

## 11. Master keyboard shortcut quick reference

| Category | Shortcut | Action |
|---|---|---|
| **Tools & modes** | <kbd>W</kbd> | Move/translation tool |
| | <kbd>E</kbd> | Rotation tool |
| | <kbd>R</kbd> | Scale tool |
| | <kbd>X</kbd> | Toggle snapping on/off |
| | <kbd>[</kbd> | Decrease grid snap step (finer: $0.1\text{m}$) |
| | <kbd>]</kbd> | Increase grid snap step (coarser: $2.0\text{m}$) |
| | <kbd>D</kbd> | Decal stamp mode on/off (<kbd>Ctrl/Cmd+D</kbd> is Duplicate) |
| | <kbd>R</kbd> / <kbd>Shift+R</kbd> *(stamp mode)* | Spin the stamp $\pm 15^\circ$ about the surface normal |
| | arrows / <kbd>Shift</kbd> + arrows *(stamp mode)* | Nudge the stamp in the surface plane / scale it |
| | <kbd>Esc</kbd> *(stamp mode)* | Leave stamp mode |
| **Transform & nudge** | $\leftarrow$ $\rightarrow$ $\uparrow$ $\downarrow$ | Move selection along the camera-cardinal XZ plane |
| | <kbd>Shift</kbd> + $\uparrow$ / $\downarrow$ or <kbd>PageUp</kbd> / <kbd>PageDown</kbd> | Move selection along the Y axis (height) |
| | <kbd>Alt</kbd> + arrows | Rotate selection by angle snap ($15^\circ$) |
| | <kbd>Alt</kbd> + <kbd>Shift</kbd> + arrows | Scale selection by scale snap ($0.25$) |
| | <kbd>End</kbd> | **Snap to floor:** drop selection flush onto $Y = 0$ floor |
| **Selection & graph** | <kbd>Left-click</kbd> | Select single object |
| | <kbd>Shift</kbd> / <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + click | Toggle/additive multi-selection |
| | <kbd>Drag on empty space</kbd> | 2D marquee selection |
| | <kbd>Ctrl+F</kbd> / <kbd>Cmd+F</kbd> | **Focus hierarchy filter:** live search & filtering of scene objects by name (<kbd>Enter</kbd> selects, <kbd>Esc</kbd> clears) |
| | <kbd>F2</kbd> / hierarchy <kbd>double-click</kbd> | **Rename object inline:** edit name in the hierarchy row (<kbd>Enter</kbd> applies, <kbd>Esc</kbd> cancels) |
| | Property panel <kbd>name field</kbd> / title <kbd>double-click</kbd> | **Direct rename:** edit object name at the top of the property inspector |
| | <kbd>Ctrl+D</kbd> | Duplicate selection (atomic batch) |
| | <kbd>Ctrl+G</kbd> | Group selection at centroid |
| | <kbd>Del</kbd> / <kbd>Backspace</kbd> | Delete selection |
| **History** | <kbd>Ctrl+Z</kbd> | Undo |
| | <kbd>Ctrl+Shift+Z</kbd> / <kbd>Ctrl+Y</kbd> | Redo |
| **Camera bookmarks** | <kbd>1</kbd> – <kbd>9</kbd> | Recall camera bookmark 1–9 |
| | <kbd>Ctrl+1</kbd> – <kbd>Ctrl+9</kbd> / right-click button | Save camera bookmark 1–9 |
| **Viewport navigation** | <kbd>Right-drag</kbd> / <kbd>Middle-drag</kbd> | Rotate view (orbit) |
| | <kbd>Alt</kbd> + left-drag / macOS <kbd>Ctrl</kbd> + left-drag | Rotate view (artist-friendly) |
| | <kbd>Shift</kbd> + right-/middle-drag | Pan view |
| | <kbd>Mouse wheel</kbd> | Zoom in/out |
