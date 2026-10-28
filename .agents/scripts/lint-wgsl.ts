/**
 * DP-7-B: WGSL structural linter (honest hardening, ADR-0044 Byte-Contract vs. Real-Probe corpus).
 *
 * HONESTY-CAP: wgsl_reflect is a PARSER + REFLECTOR, NOT a WGSL spec type-checker. It can prove:
 *   1. every `[CHUNK]` placeholder assembled away (unresolved placeholder = hard error), and
 *   2. the assembled module is syntactically parseable, and
 *   3. the binding table is self-consistent (no (group,binding) slot claimed by two resources).
 * It does NOT execute the WGSL specification (no Tint/naga semantics), so type-level errors that
 * only a spec-conformant compiler reports are out of scope here -- that tier runs at device compile
 * time (GPUDevice.createShaderModule) and is covered by golden tests, not by this linter.
 *
 * Real-assembly principle: instead of hand-mirroring the chunk table (the old lint-wgsl kept a
 * private `chunks` map that could drift), this script imports the engine's REAL ShaderRegistry and
 * drives its `assemble()` --- exactly the path the renderer uses (GPUPipelineCache / WebGPURenderer).
 * Chunk files under `.../chunks/` are NOT linted standalone (they are fragments, not modules); only
 * full shader modules get assembled + parsed.
 *
 * Compute shaders and the standalone WebGPU vertex shaders (which the legacy linter never vetted)
 * are assembled with the same prepends the renderer applies (`_computeStructsChunk()` group-0-only
 * view for compute; `[WGSL_STRUCTS]` for the standalone verts).
 */
import fs from "fs/promises";
import path from "path";
import { WgslReflect } from "wgsl_reflect/wgsl_reflect.module.js";
import { ShaderRegistry } from "../../packages/engine/src/renderers/shaders/ShaderRegistry.js";
import { wrapFragmentWithNormalOutput } from "../../packages/engine/src/renderers/WebGPU/managers/NormalOutputWrapper.js";

// ── Real registry: the same chunk table the renderer resolves wgsl placeholders with. ──────────
const registry = new ShaderRegistry();

/** Replicates `WebGPURenderer._computeStructsChunk()`: group-0-only view of the structs chunk. */
function computeStructsChunk(): string {
  const raw = registry.getChunk("WGSL_STRUCTS", "wgsl") ?? "";
  const group0Only = raw.split("@group(1)")[0] ?? raw;
  return "const USE_DECAL_GRADIENTS: bool = false;\n" + group0Only;
}

const SCAN_ROOTS = [
  "packages/engine/src/core/materials/shaders",
  "packages/engine/src/core/materials/liquid/shaders",
  "packages/engine/src/core/materials/surface/shaders",
  "packages/engine/src/core/materials/glass/shaders",
  "packages/engine/src/renderers/post/shaders",
  "packages/engine/src/renderers/shaders/source/web_gpu",
].map((d) => path.resolve(d));

interface LintTarget {
  file: string;
  kind: "material" | "post" | "compute" | "webgpu-vert";
  /** Resolved source to parse (already assembled). */
  source: string;
}

async function collectTargets(): Promise<LintTarget[]> {
  const targets: LintTarget[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Chunk files are fragments, not modules: skip any .../chunks/ subtree.
        if (entry.name === "chunks") continue;
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".wgsl")) continue;
      const rel = full.replace(/\\/g, "/");
      const kind: LintTarget["kind"] = rel.includes("/core/materials/")
        ? "material"
        : rel.includes("/renderers/post/")
          ? "post"
          : rel.includes("/web_gpu/compute/")
            ? "compute"
            : "webgpu-vert";

      const raw = await fs.readFile(full, "utf8");
      let source: string;

      if (kind === "material") {
        // Mirror the material wrapper assembly (`[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n<frag>`).
        // Skip a prepend whose placeholder the file itself already inlines (e.g. water verts).
        const prepends: string[] = [];
        if (!raw.includes("[WGSL_STRUCTS]")) prepends.push("[WGSL_STRUCTS]");
        if (!raw.includes("[WGSL_PBR_MATH]")) prepends.push("[WGSL_PBR_MATH]");
        source = registry.assemble(prepends.join("\n") + "\n" + raw, "wgsl");
      } else if (kind === "post") {
        source = registry.assemble(raw, "wgsl");
      } else if (kind === "compute") {
        // Compute pipelines are NOT uniformly assembled: each renderer site builds its module with
        // a distinct prepend. Mirror the real sites so the linter parses exactly what the device
        // compiles (honest Real-Probe, ADR 0044):
        //   - cluster_cull.wgsl:       renderer.computeStructsChunk + WGSL_SCREEN_FOOTPRINT + src  (WebGPURenderer._initClusterCulling)
        //   - hzb_visibility_test.wgsl: renderer.computeStructsChunk + WGSL_SCREEN_FOOTPRINT + src  (WebGPURenderer._initHzb)
        //   - froxel_inject.wgsl:       renderer.computeStructsChunk + src                       (VolumetricFogPassGPU._ensureInjectPipeline)
        //   - froxel_reproject.wgsl:    standalone (own group-0 bindings)                        (VolumetricFogPassGPU._buildPipelines)
        //   - froxel_integrate.wgsl:    standalone (own group-0 bindings)                        (VolumetricFogPassGPU._buildPipelines)
        //   - hzb_copy_depth.wgsl:      standalone (own group-0 bindings)                        (HzbOcclusionSystem)
        //   - hzb_downsample_max.wgsl:  standalone (own group-0 bindings)                        (HzbOcclusionSystem)
        const base = path.basename(full);
        if (base === "cluster_cull.wgsl" || base === "hzb_visibility_test.wgsl") {
          const footprint = registry.getChunk("WGSL_SCREEN_FOOTPRINT", "wgsl") ?? "";
          source = registry.assemble(computeStructsChunk() + "\n" + footprint + "\n" + raw, "wgsl");
        } else if (base === "froxel_inject.wgsl") {
          source = registry.assemble(computeStructsChunk() + "\n" + raw, "wgsl");
        } else {
          source = registry.assemble(raw, "wgsl");
        }
      } else {
        // Standalone WebGPU vertex shaders reference `global`/`obj`/`Out` from the structs chunk.
        source = registry.assemble("[WGSL_STRUCTS]\n" + raw, "wgsl");
      }

      targets.push({ file: full, kind, source });
    }
  }

  for (const root of SCAN_ROOTS) await walk(root);
  return targets;
}

/** Hard error: a `[CHUNK]` placeholder survived assembly (the renderer would compile the literal). */
function unresolvedPlaceholders(source: string): string[] {
  return source.match(/\[[A-Z][A-Z0-9_]+\]/g) ?? [];
}

function declaredSlotDuplicates(source: string): string[] {
  const failures: string[] = [];
  const seen = new Map<string, number>();
  // Only module-scope `var` declarations (the resource bindings the BGL would see). Requires the
  // attribute pair to be followed by `var` so comments/std-140 attribute noise never count, and
  // catches duplicates REGARDLESS of reachability or last-wins reflection dedup (getBindGroups
  // hides them). WGSL forbids two module-scope vars on one slot.
  const m = /@(?:group|binding)\(\s*(\d+)\s*\)\s*@(?:group|binding)\(\s*(\d+)\s*\)\s*var\b/g;
  let match: RegExpExecArray | null;
  while ((match = m.exec(source)) !== null) {
    const slot = `${match[1]}:${match[2]}`;
    seen.set(slot, (seen.get(slot) ?? 0) + 1);
  }
  for (const [slot, count] of seen) {
    if (count > 1) failures.push(`@group @binding slot ${slot} declared ${count} times`);
  }
  return failures;
}

/**
 * Binding self-consistency: across every entry stage of one module, no (group,binding) slot may be
 * claimed by two DIFFERENT resources, and no resource name may live on two different slots.
 * Returns human-readable violations.
 */
function bindingInconsistencies(reflect: WgslReflect): string[] {
  const failures: string[] = [];
  const slotToName = new Map<string, string>();
  const nameToSlot = new Map<string, string>();

  const stages: ("vertex" | "fragment" | "compute")[] = ["vertex", "fragment", "compute"];
  for (const stage of stages) {
    for (const entry of reflect.entry[stage]) {
      const resources =
        (
          entry as {
            resources?: Array<{
              group: number;
              binding: number;
              name: string;
              resourceType: number;
              access: string;
            }>;
          }
        ).resources ?? [];
      for (const res of resources) {
        const slot = `${res.group}:${res.binding}`;
        const seenName = slotToName.get(slot);
        if (seenName !== undefined && seenName !== res.name) {
          failures.push(
            `binding ${slot} claimed by both '${seenName}' and '${res.name}' (${stage} stage)`,
          );
        } else {
          slotToName.set(slot, res.name);
        }
        const seenSlot = nameToSlot.get(res.name);
        if (seenSlot !== undefined && seenSlot !== slot) {
          failures.push(
            `resource '${res.name}' lives on both ${seenSlot} and ${slot} (${stage} stage)`,
          );
        } else {
          nameToSlot.set(res.name, slot);
        }
      }
    }
  }
  return failures;
}

async function lint() {
  const targets = await collectTargets();
  let hasErrors = false;
  let checked = 0;

  for (const { file, kind, source } of targets) {
    const name = path.basename(file);
    const rel = file.replace(/\\/g, "/");
    const unresolved = unresolvedPlaceholders(source);
    if (unresolved.length > 0) {
      console.error(`❌ ${name} [${kind}] unresolved placeholder(s): ${unresolved.join(", ")}`);
      hasErrors = true;
      continue;
    }

    let reflect: WgslReflect;
    try {
      reflect = new WgslReflect(source);
    } catch (err) {
      console.error(`❌ ${name} [${kind}] WGSL parse failed:`);
      console.error((err as Error).message || String(err));
      hasErrors = true;
      continue;
    }

    const dupSlots = declaredSlotDuplicates(source);
    const violations = bindingInconsistencies(reflect);
    if (dupSlots.length > 0 || violations.length > 0) {
      console.error(`❌ ${name} [${kind}] binding-table check:`);
      for (const d of dupSlots) console.error(`    - ${d}`);
      for (const v of violations) console.error(`    - ${v}`);
      hasErrors = true;
      continue;
    }
    const bindingDelta = ` (${countResources(reflect)} resource refs)`;

    // Material fragments also compile wrapped with the normal-buffer output (ADR 0028); the
    // wrapper must not break parseability. No-op when the entry point is not wrappable.
    if (kind === "material" && !name.startsWith("Depth.")) {
      const wrapped = wrapFragmentWithNormalOutput(source);
      try {
        new WgslReflect(wrapped);
      } catch (err) {
        console.error(`❌ ${name} [${kind}] wrapped-with-normal-output parse failed:`);
        console.error((err as Error).message || String(err));
        hasErrors = true;
        continue;
      }
    }

    console.log(`✅ ${name} [${kind}]${bindingDelta}  ${rel}`);
    checked++;
  }

  console.log(
    `\nWGSL: ${checked}/${targets.length} modules assembled + parsed via real ShaderRegistry.`,
  );
  if (hasErrors) process.exit(1);
}

function countResources(reflect: WgslReflect): number {
  const stages: ("vertex" | "fragment" | "compute")[] = ["vertex", "fragment", "compute"];
  let n = 0;
  for (const stage of stages) {
    for (const entry of reflect.entry[stage]) {
      n += (entry.resources ?? []).length;
    }
  }
  return n;
}

lint().catch((err) => {
  console.error(err);
  process.exit(2);
});
