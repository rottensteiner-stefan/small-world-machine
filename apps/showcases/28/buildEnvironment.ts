import type { Scene } from "@small-world-machine/engine";
import {
  AmbientLight,
  Color,
  Cube,
  CubeLayout,
  CubeTexture,
  DirectionalLight,
  Object3D,
  SkyboxMaterial,
  Texture,
} from "@small-world-machine/engine";

/** The PBR texture sets the bench materials use (any may be missing if loading failed). */
export interface LabSurfaceTextures {
  steel: {
    diffuse?: Texture | undefined;
    normal?: Texture | undefined;
    roughness?: Texture | undefined;
  };
  brass: {
    diffuse?: Texture | undefined;
    normal?: Texture | undefined;
    roughness?: Texture | undefined;
  };
}

/** Ambient and overhead light, skybox, IBL maps and the steel/brass PBR textures. */
export async function buildEnvironment(scene: Scene): Promise<LabSurfaceTextures> {
  // Ambient Optical Environment (Dark cleanroom lab aesthetic) -- P0-1 rebalanced down
  const ambientLight = new AmbientLight({
    color: new Color(0.04, 0.05, 0.08),
    intensity: 0.12,
  });
  scene.add(ambientLight);

  // Laboratory Overhead Soft Light
  const overheadLight = new DirectionalLight({
    color: new Color(0.9, 0.95, 1.0),
    intensity: 0.25,
  });
  overheadLight.direction.set(0.3, -1, -0.4);
  scene.add(overheadLight);

  // Load Environment Map & PBR Textures
  const envTexture = new CubeTexture();
  try {
    await envTexture.loadFrom("./assets/ibl/env.webp", CubeLayout.CROSS_HORIZONTAL);
    const skybox = new Object3D("Skybox");
    skybox.geometry = new Cube({ size: 1000 }).getGeometryData();
    // The raw env panorama is a bright studio HDR plate; shown undimmed it floods the dark
    // cleanroom look with haze and blows the frame (it is ALSO the IBL light source, so keep
    // the texture, only darken the visible sky to a near-black lab backdrop).
    skybox.material = new SkyboxMaterial({
      cubeMap: envTexture,
      color: new Color(0.03, 0.035, 0.05),
    });
    skybox.frustumCulled = false;
    scene.add(skybox);
  } catch (e) {
    console.warn("Could not load envmap:", e);
  }

  // Real IBL (irradiance/prefilter/BRDF LUT), baked via tools/ibl-gen.html from a
  // freshly-generated panorama matching this scene's own skybox -- replaces the previous
  // (physically wrong) reuse of the raw, unconvolved skybox as both diffuse and specular map.
  try {
    const brdfTexture = await Texture.fromUrl("./assets/ibl/brdf_lut.webp", { flipY: false });
    const irradianceTexture = new CubeTexture();
    await irradianceTexture.loadFrom("./assets/ibl/irradiance.webp", CubeLayout.CROSS_HORIZONTAL);
    const prefilterTexture = new CubeTexture();
    await prefilterTexture.loadMipmapsFrom(
      [
        "./assets/ibl/prefilter/mip0.webp",
        "./assets/ibl/prefilter/mip1.webp",
        "./assets/ibl/prefilter/mip2.webp",
        "./assets/ibl/prefilter/mip3.webp",
        "./assets/ibl/prefilter/mip4.webp",
      ],
      CubeLayout.CROSS_HORIZONTAL,
    );

    scene.brdfLUT = brdfTexture;
    scene.irradianceMap = irradianceTexture;
    scene.prefilterMap = prefilterTexture;
    scene.environmentIntensity = 0.34;
  } catch (e) {
    console.warn("IBL maps not loaded:", e);
  }

  let steelDiffuse: Texture | undefined;
  let steelNormal: Texture | undefined;
  let steelRoughness: Texture | undefined;

  let brassDiffuse: Texture | undefined;
  let brassNormal: Texture | undefined;
  let brassRoughness: Texture | undefined;

  try {
    steelDiffuse = await Texture.fromUrl("../shared/assets/scratched_steel_diffuse.webp");
    if (steelDiffuse) {
      steelDiffuse.repeat.x = 1.5;
      steelDiffuse.repeat.y = 1.5;
    }
    steelNormal = await Texture.fromUrl("../shared/assets/scratched_steel_normal.webp");
    if (steelNormal) {
      steelNormal.repeat.x = 1.5;
      steelNormal.repeat.y = 1.5;
    }
    steelRoughness = await Texture.fromUrl("../shared/assets/scratched_steel_roughness.webp");
    if (steelRoughness) {
      steelRoughness.repeat.x = 1.5;
      steelRoughness.repeat.y = 1.5;
    }

    brassDiffuse = await Texture.fromUrl("../shared/assets/rusty_brass_diffuse.webp");
    brassNormal = await Texture.fromUrl("../shared/assets/rusty_brass_normal.webp");
    brassRoughness = await Texture.fromUrl("../shared/assets/rusty_brass_roughness.webp");
  } catch (e) {
    console.warn("Could not load PBR textures:", e);
  }
  return {
    steel: { diffuse: steelDiffuse, normal: steelNormal, roughness: steelRoughness },
    brass: { diffuse: brassDiffuse, normal: brassNormal, roughness: brassRoughness },
  };
}
