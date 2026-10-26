import fs from "fs/promises";
import path from "path";
import { validate, formatDiagnostic, LIMITS } from "@moreplease/glslang";

interface ShaderChunkSets {
  chunks300: Map<string, string>;
  chunks100: Map<string, string>;
}

const shaderDirs = [
  "packages/engine/src/core/materials/shaders",
  "packages/engine/src/core/materials/liquid/shaders",
  "packages/engine/src/core/materials/surface/shaders",
  "packages/engine/src/core/materials/glass/shaders",
  "packages/engine/src/renderers/post/shaders",
  "packages/liquid-extras/src/materials",
  "packages/artistic-extras/src/materials/shaders",
  "packages/artistic-extras/src/post/shaders",
  "apps/sample-apps/voxel-prototype/voxel/material/shaders",
].map((d) => path.resolve(d));

async function loadChunks(): Promise<ShaderChunkSets> {
  const chunks300 = new Map<string, string>();
  const chunks100 = new Map<string, string>();

  const loadFrom = async (dir: string, map: Map<string, string>): Promise<void> => {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".glsl") || file.endsWith(".frag.glsl") || file.endsWith(".vert.glsl")) {
          const name = file.replace(/\.frag\.glsl$|\.vert\.glsl$|\.glsl$/, "").toUpperCase();
          const content = await fs.readFile(path.join(dir, file), "utf8");
          map.set(name, content);
        }
      }
    } catch {
      // Directory optional
    }
  };

  // Load WebGL2-specific and shared chunks
  await loadFrom(
    path.resolve("packages/engine/src/renderers/shaders/source/web_gl2/chunks"),
    chunks300,
  );
  await loadFrom(path.resolve("packages/engine/src/core/materials/shaders/chunks"), chunks300);
  await loadFrom(path.resolve("packages/engine/src/renderers/shaders/source/shared"), chunks300);

  // Load WebGL1-specific and shared chunks
  await loadFrom(
    path.resolve("packages/engine/src/renderers/shaders/source/web_gl1/chunks"),
    chunks100,
  );
  await loadFrom(path.resolve("packages/engine/src/core/materials/shaders/chunks"), chunks100);
  await loadFrom(path.resolve("packages/engine/src/renderers/shaders/source/shared"), chunks100);

  // Base files
  try {
    const gl1BaseFs = await fs.readFile(
      path.resolve("packages/engine/src/renderers/shaders/source/web_gl1/base.frag.glsl"),
      "utf8",
    );
    chunks100.set("BASE_FS_HEADER", gl1BaseFs);
    const gl1BaseVs = await fs.readFile(
      path.resolve("packages/engine/src/renderers/shaders/source/web_gl1/base.vert.glsl"),
      "utf8",
    );
    chunks100.set("BASE_VS", gl1BaseVs);
  } catch {
    // Optional
  }

  // Shadow chunks
  try {
    const dirShadow300 = await fs.readFile(
      path.resolve("packages/engine/src/core/materials/shaders/chunks/dir_shadow.glsl"),
      "utf8",
    );
    chunks300.set("DIR_SHADOW", dirShadow300);
    const dirShadow100 = await fs.readFile(
      path.resolve("packages/engine/src/core/materials/shaders/chunks/dir_shadow_webgl1.glsl"),
      "utf8",
    );
    chunks100.set("DIR_SHADOW", dirShadow100);
  } catch {
    // Optional
  }

  // Liquid and puddle chunks
  try {
    const extDefault = await fs.readFile(
      path.resolve("packages/engine/src/core/materials/shaders/chunks/liquid_ext_default.glsl"),
      "utf8",
    );
    chunks300.set("WATER_EXT_DECL", extDefault);
    chunks300.set("WATER_EXT_SURFACE", extDefault);
    chunks100.set("WATER_EXT_DECL", extDefault);
    chunks100.set("WATER_EXT_SURFACE", extDefault);

    const rainCommon = await fs.readFile(
      path.resolve("packages/liquid-extras/src/materials/RainPuddle/RainPuddle.common.glsl"),
      "utf8",
    );
    chunks300.set("RAIN_PUDDLE_COMMON", rainCommon);
    chunks100.set("RAIN_PUDDLE_COMMON", rainCommon);
  } catch {
    // Optional
  }

  const thinFilmDecl = `
vec3 oilFilmThinFilm(float cosTheta1, float thicknessNorm, float strength) {
    return vec3(1.0);
}
vec3 oilFilmRainbow(float thicknessNorm, float strength) {
    return vec3(1.0);
}
`;
  chunks300.set("THIN_FILM_DECL", thinFilmDecl);
  chunks100.set("THIN_FILM_DECL", thinFilmDecl);

  const lights300 = chunks300.get("LIGHTS");
  if (lights300) chunks300.set("LIGHT_DEFS", lights300);
  const lights100 = chunks100.get("LIGHTS");
  if (lights100) chunks100.set("LIGHT_DEFS", lights100);

  chunks300.set("FILTER_COLOR_GRADING", "");
  chunks100.set("FILTER_COLOR_GRADING", "");

  return { chunks300, chunks100 };
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collectFiles(fullPath)));
      } else if (entry.name.endsWith(".glsl") || entry.name.endsWith(".glsl100")) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory might not exist
  }
  return results;
}

export async function lintGlsl(filesToCheck?: string[]): Promise<boolean> {
  const { chunks300, chunks100 } = await loadChunks();
  let filePaths = filesToCheck && filesToCheck.length > 0 ? filesToCheck : [];

  if (filePaths.length === 0) {
    for (const dir of shaderDirs) {
      filePaths.push(...(await collectFiles(dir)));
    }
  }

  // Deduplicate and filter out chunk definition files themselves (chunks are partial snippets).
  // Everything under renderers/shaders/source/ is a ShaderRegistry chunk source, including the
  // WebGL1 BASE_FS_HEADER / BASE_VS files that sit outside a chunks/ folder.
  filePaths = Array.from(new Set(filePaths)).filter(
    (fp) =>
      !fp.includes("/chunks/") &&
      !fp.includes("/renderers/shaders/source/") &&
      !fp.endsWith(".common.glsl"),
  );

  let hasErrors = false;

  for (const filePath of filePaths) {
    const relative = path.relative(process.cwd(), filePath);
    const content = await fs.readFile(filePath, "utf8");

    // 1. Strict Compiler Check: #version must be line 1 (ANGLE / SwiftShader requirement)
    if (content.includes("#version 300 es")) {
      const firstLine = content.split("\n")[0]?.trim();
      if (firstLine !== "#version 300 es") {
        console.error(
          `❌ ${relative}: '#version 300 es' must be on the very first line (ANGLE ES3 requirement)`,
        );
        hasErrors = true;
        continue;
      }
    }

    // 2. Strict Compiler Check: Storage qualifier order (flat in / flat out, not out flat / in flat)
    const invalidQualifier = content.match(/\b(in|out)\s+flat\b/);
    if (invalidQualifier) {
      console.error(
        `❌ ${relative}: Invalid storage qualifier order '${invalidQualifier[0]}'. Must be 'flat ${invalidQualifier[1]}' in GLSL ES 3.00.`,
      );
      hasErrors = true;
      continue;
    }

    const isGlsl100 = filePath.endsWith(".glsl100");
    const chunks = isGlsl100 ? chunks100 : chunks300;

    // 3. Resolve [CHUNK] placeholders recursively, like ShaderRegistry.assemble (only recognized chunks)
    const resolve = (source: string): string =>
      source.replace(/\[([A-Z0-9_]+)\]/g, (match, key: string) =>
        chunks.has(key) ? resolve(chunks.get(key)!) : match,
      );
    const assembled = resolve(content);

    // 4. Validate with Khronos glslang
    const isFragment = filePath.includes(".frag");
    const isVertex = filePath.includes(".vert");
    const stage = isVertex ? ("vertex" as const) : isFragment ? ("fragment" as const) : undefined;
    const target = isGlsl100 ? "webgl1" : "webgl2";

    try {
      const res = await validate(
        [
          {
            name: path.basename(filePath),
            source: assembled,
            ...(stage !== undefined ? { stage } : {}),
          },
        ],
        {
          target,
          limits: isGlsl100
            ? { ...LIMITS.webgl1, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 16 }
            : { ...LIMITS.webgl2, maxFragmentUniformVectors: 1024, maxTextureImageUnits: 32 },
        },
      );

      if (res.ok) {
        console.log(`✅ ${relative} passed validation.`);
      } else {
        console.error(`❌ ${relative} glslang validation failed:`);
        console.error(res.diagnostics.map(formatDiagnostic).join("\n"));
        hasErrors = true;
      }
    } catch (err: unknown) {
      console.error(`❌ ${relative} compiler error:`);
      console.error((err as Error).message || err);
      hasErrors = true;
    }
  }

  return !hasErrors;
}

// Direct CLI invocation
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const args = process.argv.slice(2).filter((a) => a.endsWith(".glsl") || a.endsWith(".glsl100"));
  lintGlsl(args)
    .then((ok) => {
      if (!ok) process.exit(1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
