import fs from "fs/promises";
import path from "path";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { wrapFragmentWithNormalOutput } from "../packages/engine/src/renderers/WebGPU/managers/NormalOutputWrapper.js";

const chunksDir = path.resolve("packages/engine/src/renderers/shaders/source/web_gpu/chunks");
const localChunksDir = path.resolve("packages/engine/src/core/materials/shaders/chunks");
const shaderDirs = [
  "packages/engine/src/core/materials/shaders",
  "packages/engine/src/core/materials/liquid/shaders",
  "packages/engine/src/core/materials/surface/shaders",
  "packages/engine/src/core/materials/glass/shaders",
  "packages/engine/src/renderers/post/shaders",
].map((d) => path.resolve(d));

async function loadChunksFromDir(dir: string, chunks: Map<string, string>) {
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.endsWith(".wgsl")) {
        const name = file.replace(".wgsl", "").toUpperCase();
        const content = await fs.readFile(path.join(dir, file), "utf8");

        // WGSL chunks often correspond to standard keys
        let key = name;
        if (name === "LIGHTING_PBR") key = "WGSL_PBR_LIGHTING";
        if (name === "LIGHTING") key = "WGSL_LIGHTING";
        if (name === "FOG_CALC") key = "WGSL_FOG_CALC";
        if (name === "GLASS_PBR_LOOPS") key = "WGSL_GLASS_PBR_LOOPS";

        chunks.set(key, content);
      }
    }
  } catch (e) {
    console.warn(`Could not read chunks from directory: ${dir}`, e);
  }
}

async function loadChunks() {
  const chunks = new Map<string, string>();
  await loadChunksFromDir(chunksDir, chunks);
  await loadChunksFromDir(localChunksDir, chunks);

  // Dynamically assemble FILTER_COLOR_GRADING for the linter
  const gradingWgsl = `
  if (1u == u.filterMode) {
      ${chunks.get("FILTER_NIGHT_VISION") || ""}
  } else if (2u == u.filterMode) {
      ${chunks.get("FILTER_NOIR") || ""}
  } else if (3u == u.filterMode) {
      ${chunks.get("FILTER_CYBER_GLITCH") || ""}
  } else if (4u == u.filterMode) {
      ${chunks.get("FILTER_VHS_TAPE") || ""}
  } else if (5u == u.filterMode) {
      ${chunks.get("FILTER_UNDERWORLD") || ""}
  } else if (6u == u.filterMode) {
      ${chunks.get("FILTER_OLD_PROJECTOR") || ""}
  } else if (7u == u.filterMode) {
      ${chunks.get("FILTER_THERMAL_VISION") || ""}
  }
  `;
  chunks.set("FILTER_COLOR_GRADING", gradingWgsl);

  return chunks;
}

async function lintWgsl() {
  const chunks = await loadChunks();
  const entries: { file: string; filePath: string }[] = [];
  for (const dir of shaderDirs) {
    for (const file of await fs.readdir(dir))
      entries.push({ file, filePath: path.join(dir, file) });
  }
  let hasErrors = false;

  for (const { file, filePath } of entries) {
    if (!file.endsWith(".wgsl")) continue;

    let code = await fs.readFile(filePath, "utf8");

    // Simple regex to replace chunks like [WGSL_PBR_LIGHTING]
    code = code.replace(/\[([A-Z_]+)\]/g, (match, key) => {
      // If it's a global struct chunk, we prepend it manually later,
      // but let's replace what we can
      return chunks.get(key) || match;
    });

    // We also need to prepend the structs and bindings which are usually added by the engine
    const structs = chunks.get("STRUCTS") || "";
    // pbr_math is needed if it's PBR
    const pbrMath = chunks.get("PBR_MATH") || "";

    // In actual engine, structs.wgsl is prepended to everything
    code = structs + "\n" + pbrMath + "\n" + code;

    try {
      new WgslReflect(code);
      console.log(`✅ ${file} passed validation.`);
      if (filePath.includes("/core/materials/") && !file.startsWith("Depth.")) {
        new WgslReflect(wrapFragmentWithNormalOutput(code));
        console.log(`✅ ${file} passed validation with the normal-buffer wrapper.`);
      }
    } catch (err: unknown) {
      console.error(`❌ ${file} validation failed:`);
      console.error((err as Error).message || err);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
}

lintWgsl().catch(console.error);
