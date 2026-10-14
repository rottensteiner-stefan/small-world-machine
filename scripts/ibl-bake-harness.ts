// Browser-side harness for the headless IBL bake. Bundled by scripts/ibl-bake.ts
// with esbuild (IIFE) and embedded into a throw-away page via Puppeteer. It drives
// the REAL engine pipeline (IBLBaker) with a generated equirectangular input and
// returns only PNG payloads — all hashing/manifest logic stays in Node.

import { IBLBaker } from "../packages/tools/src/ibl-gen/ibl-gen.js";
import type { IblGenDefaults } from "../packages/tools/src/ibl-gen/ibl-gen-core.js";

export interface IblBakeOutput {
  name: string;
  base64: string;
}

export interface IblBakeConfig {
  /** base64 (standard alphabet) PNG bytes of the equirectangular input image. */
  pngBase64: string;
  /** Bake resolutions; the same values end up in the manifest, so they must be what is baked. */
  options: IblGenDefaults;
  /** Export linear values instead of gamma-encoded ones (the engine encodes at the end of the pipeline). */
  linear?: boolean;
}

declare global {
  interface Window {
    __swIblBake: (config: IblBakeConfig) => Promise<{ outputs: IblBakeOutput[] }>;
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

window.__swIblBake = async (config: IblBakeConfig): Promise<{ outputs: IblBakeOutput[] }> => {
  const { options } = config;
  const linear = config.linear ?? false;
  const baker = new IBLBaker(options);

  const raw = atob(config.pngBase64);
  const pngBytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    pngBytes[i] = raw.charCodeAt(i);
  }
  const inputFile = new File([pngBytes], "input.png", { type: "image/png" });

  const outputs: IblBakeOutput[] = [];
  try {
    await baker.generateBRDF("brdfCanvas");
    const equiTex = await baker.loadEquirectangularImage(inputFile);
    const envCube = await baker.generateEnvironmentCubemap(equiTex, "envCanvas");
    const irrCube = await baker.generateIrradianceCubemap(envCube, "irradianceCanvas");
    const prefCube = await baker.generatePrefilteredCubemap(envCube, "prefilterCanvas");

    outputs.push(
      {
        name: "env.png",
        base64: await blobToBase64(
          await baker.exportCubemapToCross(envCube, options.envResolution, 0, linear),
        ),
      },
      {
        name: "irradiance.png",
        base64: await blobToBase64(
          await baker.exportCubemapToCross(irrCube, options.irradianceResolution, 0, linear),
        ),
      },
      {
        name: "brdf_lut.png",
        base64: await blobToBase64(await baker.exportBRDFToBlob("brdfCanvas")),
      },
    );

    let prefilterSize = options.prefilterResolution;
    for (let mip = 0; mip < options.prefilterMips; mip++) {
      outputs.push({
        name: `prefilter/mip${mip}.png`,
        base64: await blobToBase64(
          await baker.exportCubemapToCross(prefCube, prefilterSize, mip, linear),
        ),
      });
      prefilterSize = Math.floor(prefilterSize / 2);
    }
  } finally {
    baker.dispose();
  }

  return { outputs };
};
