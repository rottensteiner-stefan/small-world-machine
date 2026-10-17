import type { PointLightOptions } from "../../../core/lights/PointLight.js";
import { PointLight } from "../../../core/lights/PointLight.js";
import { DirectionalLight } from "../../../core/lights/DirectionalLight.js";
import { SpotLight } from "../../../core/lights/SpotLight.js";
import type { AbstractLight, LightOptions } from "../../../core/lights/AbstractLight.js";
import { Color } from "../../../core/colors/Color.js";
import { Vector3D } from "../../../math/index.js";
import type { GltfExtensionPlugin } from "../GltfExtensionPlugin.js";
import type { GltfLightJson } from "../writerTypes.js";

interface PunctualLightDef {
  type: string;
  color?: number[];
  intensity?: number;
  range?: number;
  spot?: { innerConeAngle?: number; outerConeAngle?: number };
  extras?: LightExtras;
}

/** Engine-specific light fields stored in the glTF light's `extras`. */
type LightExtras = {
  direction?: number[];
  castShadow?: boolean;
  shadowResolution?: number;
  shadowBias?: number;
  shadowNormalBias?: number;
  numCascades?: number;
  cascadeSplitLambda?: number;
  decay?: number;
};

/** Engine fields every light type keeps in `extras` (KHR_lights_punctual has no shadow slots). */
function writeShadowExtras(light: AbstractLight, extras: LightExtras): void {
  extras.castShadow = light.castShadow;
  extras.shadowResolution = light.shadowResolution;
  extras.shadowBias = light.shadowBias;
  extras.shadowNormalBias = light.shadowNormalBias;
}

function readShadowOptions(extras: LightExtras | undefined): LightOptions {
  const options: LightOptions = {};
  if (undefined === extras) return options;
  if (undefined !== extras.castShadow) options.castShadow = extras.castShadow;
  if ("number" === typeof extras.shadowResolution)
    options.shadowResolution = extras.shadowResolution;
  if (undefined !== extras.shadowBias) options.shadowBias = extras.shadowBias;
  if ("number" === typeof extras.shadowNormalBias)
    options.shadowNormalBias = extras.shadowNormalBias;
  return options;
}

function readDirection(extras: LightExtras | undefined): Vector3D | undefined {
  const d = extras?.direction;
  if (undefined === d || 3 !== d.length) return undefined;
  return new Vector3D(d[0]!, d[1]!, d[2]!);
}

function lightToDef(obj: unknown): GltfLightJson | undefined {
  if (obj instanceof PointLight) {
    return {
      type: "point",
      color: [obj.color.r, obj.color.g, obj.color.b],
      intensity: obj.intensity,
      range: obj.distance,
    };
  }
  if (obj instanceof DirectionalLight) {
    const extras: LightExtras = {
      direction: [obj.direction.x, obj.direction.y, obj.direction.z],
      numCascades: obj.numCascades,
      cascadeSplitLambda: obj.cascadeSplitLambda,
    };
    writeShadowExtras(obj, extras);
    return {
      type: "directional",
      color: [obj.color.r, obj.color.g, obj.color.b],
      intensity: obj.intensity,
      extras,
    };
  }
  if (obj instanceof SpotLight) {
    const extras: LightExtras = {
      direction: [obj.direction.x, obj.direction.y, obj.direction.z],
      decay: obj.decay,
    };
    writeShadowExtras(obj, extras);
    return {
      type: "spot",
      color: [obj.color.r, obj.color.g, obj.color.b],
      intensity: obj.intensity,
      range: obj.distance,
      spot: { innerConeAngle: obj.angle * (1 - obj.penumbra), outerConeAngle: obj.angle },
      extras,
    };
  }
  return undefined;
}

const LIGHT_DEFS_KEY = "KHR_lights_punctual.lightDefsByNode";
const WRITE_LIGHTS_KEY = "KHR_lights_punctual.lights";

/**
 * `KHR_lights_punctual` -- Khronos-ratified extension for punctual lights: `"point"`,
 * `"directional"` and `"spot"`. The engine's own `direction` (not derived from the node rotation),
 * shadow settings, decay and cascade settings travel in the light's `extras`. Ambient lights have
 * no KHR counterpart and use `SWM_light_ambient` instead.
 */
export const khrLightsPunctual: GltfExtensionPlugin = {
  name: "KHR_lights_punctual",

  prepareRead(ctx) {
    const defsByNode = new Map<number, PunctualLightDef>();
    const punctualLights = ctx.json.extensions?.KHR_lights_punctual?.lights;
    if (punctualLights && ctx.json.nodes) {
      for (let i = 0; i < ctx.json.nodes.length; i++) {
        const lightIdx = ctx.json.nodes[i]?.extensions?.KHR_lights_punctual?.light;
        if (lightIdx === undefined) continue;
        const def = punctualLights[lightIdx];
        if (def) defsByNode.set(i, def);
      }
    }
    ctx.state.set(LIGHT_DEFS_KEY, defsByNode);
  },

  readNode(nodeIndex, _nodeDef, name, ctx) {
    const defsByNode = ctx.state.get(LIGHT_DEFS_KEY) as Map<number, PunctualLightDef> | undefined;
    const def = defsByNode?.get(nodeIndex);
    if (!def) return undefined;

    const options: PointLightOptions = { name, ...readShadowOptions(def.extras) };
    if (def.color) options.color = new Color(def.color[0]!, def.color[1]!, def.color[2]!);
    if (undefined !== def.intensity) options.intensity = def.intensity;
    const extras = def.extras;
    if ("directional" === def.type) {
      const direction = readDirection(extras);
      return new DirectionalLight({
        ...options,
        ...(direction ? { direction } : {}),
        ...(undefined !== extras?.numCascades ? { numCascades: extras.numCascades } : {}),
        ...(undefined !== extras?.cascadeSplitLambda
          ? { cascadeSplitLambda: extras.cascadeSplitLambda }
          : {}),
      });
    }
    if ("spot" === def.type) {
      const direction = readDirection(extras);
      const outer = def.spot?.outerConeAngle;
      const inner = def.spot?.innerConeAngle;
      return new SpotLight({
        ...options,
        ...(direction ? { direction } : {}),
        ...(undefined !== def.range ? { distance: def.range } : {}),
        ...(undefined !== outer ? { angle: outer } : {}),
        // three.js convention: penumbra = (outer - inner) / outer
        ...(undefined !== outer && undefined !== inner && 0 < outer
          ? { penumbra: (outer - inner) / outer }
          : {}),
        ...(undefined !== extras?.decay ? { decay: extras.decay } : {}),
      });
    }
    if ("point" !== def.type) return undefined;
    if (undefined !== def.range) options.distance = def.range;
    return new PointLight(options);
  },

  writeNode(obj, node, ctx) {
    const def = lightToDef(obj);
    if (!def) return;
    let lights = ctx.state.get(WRITE_LIGHTS_KEY) as GltfLightJson[] | undefined;
    if (!lights) {
      lights = [];
      ctx.state.set(WRITE_LIGHTS_KEY, lights);
    }
    const index = lights.length;
    lights.push(def);
    node.extensions = { ...node.extensions, KHR_lights_punctual: { light: index } };
  },

  finalizeWrite(ctx) {
    const lights = ctx.state.get(WRITE_LIGHTS_KEY) as GltfLightJson[] | undefined;
    if (lights && 0 < lights.length) {
      ctx.doc.extensions = { ...ctx.doc.extensions, KHR_lights_punctual: { lights } };
    }
  },
};
