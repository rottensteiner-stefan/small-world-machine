# Recommended external toolchain

While the **Small World Machine** engine and its Node/Vite ecosystem handle core rendering and logic, building a complete 3D/2.5D game needs a supporting ecosystem of external art and asset tools.

Here's the recommended toolchain for working efficiently with the engine:

## 1. 3D modeling & rigging: Blender
* **Role:** The absolute standard for 3D modeling, rigging, and animation.
* **Usage:**
  * Import Mixamo/Sketchfab models to edit skeletons, adjust weights, or combine animations.
  * Design levels and export NavMeshes (invisible collision/walkable areas) for the engine.
  * Optimize geometry (reduce polygons) and bake PBR textures into single atlases to reduce WebGL/WebGPU draw calls.
* **Status:** Essential.

## 2. GLTF/GLB optimization: glTF-Transform
* **Role:** Khronos Group's CLI toolsuite for strong asset compression.
* **Usage:**
  * Unoptimized `.glb` files (e.g. direct Mixamo exports) often contain uncompressed data, unused bones, or massive animation tracks (30MB+).
  * `gltf-transform` lets you apply **Draco** or **Meshopt** compression, quantization, and pruning directly from the terminal, often shrinking assets down to 1-2 MB.
  * *Tip:* Can be run locally via `npx @gltf-transform/cli`.
* **Status:** Strongly recommended (for production builds).

## 3. 2.5D art & textures: Krita / Photoshop / Affinity
* **Role:** 2D image editing, matte painting, and layer cutouts.
* **Usage:**
  * Create the static 2.5D backgrounds ("peepshow principle") by painting over 3D blockouts or AI-generated concepts.
  * Create foreground cutouts (transparent layers like pillars, railings, pipes) for characters to walk behind.
  * Create alpha masks for depth compositing in the shader.
  * **File format standard:** Export finished 2D assets as **WebP (`.webp`)**, for lossless/lossy compression without JPEG block artifacts, with full alpha transparency support and a small footprint (~200KB per 1080p panel).
* **Status:** Essential.

## 4. Audio engineering: Audacity
* **Role:** Free, open-source audio editor.
* **Usage:**
  * Trim, loop, and mix raw sound effects (footsteps, UI clicks, ambient tracks).
  * Export optimized `.ogg` or `.mp3` files for the engine's audio context.
* **Status:** Essential (once audio implementation begins).

## 5. FBX-to-GLTF conversion: fbx2gltf / web converters
* **Role:** Format conversion for 3D assets.
* **Usage:**
  * Small World Machine exclusively uses the open `glTF/GLB` standard via `GltfLoader`.
  * When downloading `.fbx` files (e.g. from Mixamo), they need to be converted. This can be done via the `fbx2gltf` CLI tool or quickly via web converters like [AnyConv](https://anyconv.com/fbx-to-glb-converter/).
* **Status:** Necessary auxiliary tool.

## 6. AI concept art & background inpainting: integrated image generator
* **Role:** Automated generation and editing of 2.5D matte-painting backgrounds and concept art.
* **Usage:**
  * Generate consistent, graphic-noir-style environment sketches and scene backgrounds.
  * Image-to-image editing/inpainting (e.g. removing temporary characters/objects from background panels to create clean, empty 2.5D stages).
  * Direct execution via the agent's `generate_image` tool with reference image inputs.
  * **Aspect ratio standard:** Always enforce `AspectRatio: "16:9"` to match the 3D stage's `Plane({ width: 16, height: 9 })` distortion-free, 1:1.
* **Status:** Integrated agent capability.
