# Material Studio (PBR Map Generator)

::: tip What this tool actually is
The name suggests a material *editor* — something that lets you tweak a `StandardMaterial`/`GlassMaterial` on a selected scene object, the way [Maker](/guides/maker) does. It isn't that. **Material Studio is a PBR texture map generator**: you give it a diffuse image, and it derives a height, normal, specular, roughness, ambient occlusion, and edge map from it via 2D image-processing heuristics — then lets you preview the result on a sample mesh in an isolated sandbox scene. It never touches your actual running game scene.
:::

## Enabling it

Call `attachDevTools(app)` from `@small-world-machine/tools`, and Material Studio opens as one of the docked Forge windows:

```typescript
import { SmallWorldMachine } from "@small-world-machine/engine";
import { attachDevTools } from "@small-world-machine/tools";

const app = new MyGame();
attachDevTools(app);
app.start();
```

Press **Ctrl+Alt+G** (or **Cmd+Alt+G**) to show/hide the Forge overlay.

::: tip In Maker and as a standalone page
Material Studio is also a mode of the Maker shell: open `maker.html#material` (or the **Material** tab). The shell builds a fresh studio on every entry and tears it down on exit, so its drop/paste listeners do not outlive the mode; the loaded texture and slider settings are not carried across a mode switch.

A close relative lives at `/tools/pbr-gen.html` with its own UI (ZIP export, JSON profile). Its map derivation is no longer a copy: both it and the studio call `derivePbrMaps` from `packages/tools/src/core/material.ts`, the same function the `swm` CLI uses. A golden test (`tests/core/materialGolden.test.ts`) pins the output byte for byte against the page's original inline pipeline.
:::

## Loading a source image

Drag and drop onto the dropzone (or anywhere on the window), click it to open a file picker, or paste directly (`Ctrl/Cmd+V`). The `UniversalIngestDropzone` accepts images, PBR sets, ZIP archives, SVG and text/data URLs, up to 50 MB by default (`SecurityValidator`). The map derivation and presets live headless in `packages/tools/src/core/material.ts` (`derivePbrMaps`, `MATERIAL_STUDIO_PRESETS`). If nothing is loaded, a bundled stone texture is used by default — falling back to a synthetic, procedural noise texture if even that fails to load.

## Generating maps

A "Preset Profile" dropdown (Default, Stone, Metal, Wood) sets a starting point for seven groups of controls, each tuning one derived map:

- **Height Map** — blur radius, contrast, invert.
- **Normal Map** — bump strength, OpenGL/DirectX format, invert red channel.
- **Specular Map** — sigmoidal contrast and midpoint threshold.
- **Roughness Map** — gamma exponent.
- **Ambient Occlusion** — soft-shadow blur, crevice strength, intensity.
- **Edge Map** — contrast threshold and thickness.
- **3D Preview** — metallic base and roughness override, which only affect the local preview, not any exported map.

Every control change reprocesses the image immediately (with a brief loading overlay). At higher "Working Max Resolution" settings (1024px or original size), this recomputation runs on the main thread and can noticeably stall the UI for a moment — the trade-off for not shipping a worker-based pipeline.

::: warning These are fast approximations, not baked PBR maps
Normal maps come from a Sobel gradient over the height map's luminance, not a real high-to-low-poly bake. Ambient occlusion is a Laplacian-crevice-plus-blur heuristic, not raytraced or SSAO. Specular/roughness are gamma/sigmoid curve transforms of the same height data. This is a genuinely useful quick start for a plausible-looking material, not a physically accurate map baker — don't expect studio-grade results from a single diffuse photo.
:::

## Preview and export

Switch between tabs to view a single map, the full grid of all seven, or a **"Small World Machine Preview"** — a live, auto-rotating sphere/cube/torus/plane, rendered with your generated maps on a `StandardMaterial`, in Material Studio's own isolated preview scene (it has nothing to do with your game's actual scene or objects).

Export is plain PNG, no bundling:

- Clicking a single map's canvas, or its download icon in the grid view, saves that one map as `<filename>_<maptype>.png`.
- **Download All Maps** triggers all six downloads (Height/Normal/Specular/Roughness/AO/Edge) in sequence — there is no zip bundling.

There is no material JSON export and no way to apply the result back to an object in your running scene — bringing the generated textures into your actual game is a manual step (load the downloaded PNGs like any other texture asset).

## Limitations

- **Only `StandardMaterial` is supported** — there is no material type selector, and none of the engine's other material classes (Glass, Terrain, Phong, custom shaders, etc.) are represented anywhere in this tool.
- **No scene integration.** You cannot select and edit a live object/material — everything happens in an isolated preview sandbox.
- **No persistence.** Reopening the window always starts with the default image and default preset; nothing you configure survives a reload.
- **PNG export only**, no material configuration JSON, no zip bundling of the six maps.
- The generated maps are approximate, image-processing-based heuristics — see the warning above.
