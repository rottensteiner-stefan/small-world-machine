import type { RenderManifest, ShaderDefinition } from "@small-world-machine/engine";
import { AbstractMaterial, StandardWebGPULayout } from "@small-world-machine/engine";

const vertWGSL = `
[WGSL_STRUCTS]

@vertex
fn vs(
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec3f
) -> Out {
    var out: Out;

    let worldPosInit = obj.model * vec4f(position, 1.0);
    
    var totalHeight = 0.0;
    var dHdx = 0.0;
    var dHdz = 0.0;

    // Viscous oil, not water: ripples crawl outward instead of racing (speed), read as fewer,
    // broader undulations instead of tight rings (freq), have a wide, blurry wavefront instead
    // of a sharp ring edge (decay), and settle back to stillness quickly (time-decay exponent
    // below) rather than ringing for seconds like a thin liquid would.
    let freq = 6.0;
    let speed = 1.8;
    let decay = 0.6;

    let time = obj.time;
    let ripples = array<vec4f, 3>(obj.extraParams, obj.liquidParams, obj.thresholds);

    for (var i = 0u; i < 3u; i = i + 1u) {
        let r = ripples[i];
        if (r.w > 0.0) {
            let dX = worldPosInit.x - r.x;
            let dZ = worldPosInit.z - r.y;
            let dist = sqrt(dX * dX + dZ * dZ) + 0.0001;

            let age = time - r.z;
            if (age > 0.0 && age < 5.0) {
                let ringCenter = age * speed;
                let distFromRing = abs(dist - ringCenter);

                let amplitude = r.w * exp(-age * 0.9) * exp(-distFromRing * decay);
                let phase = (dist - ringCenter) * freq;
                
                let h = amplitude * sin(phase);
                totalHeight += h;
                
                let deriv = amplitude * cos(phase) * freq;
                dHdx += deriv * (dX / dist);
                dHdz += deriv * (dZ / dist);
            }
        }
    }

    var worldPos = worldPosInit;
    worldPos.y += totalHeight;

    // Normal recalculation in world space, then transformed back or kept in world space?
    // Since we need world normal for lighting, we can just supply it directly!
    let worldNormal = normalize(vec3f(-dHdx, 1.0, -dHdz));
    
    out.pos = global.vp * worldPos;
    out.wp = worldPos.xyz;
    // We already have the world normal
    out.n = worldNormal;
    out.uv = uv;
    out.t = normalize((obj.model * vec4f(tangent, 0.0)).xyz);
    out.b = normalize(cross(out.n, out.t));
    out.original_uv = uv;
    out.texIndex = 0.0;

    return out;
}
`;

const fragWGSL = `
// Pseudo-random hash for value noise
fn hash(p: vec2f) -> f32 {
    let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
    return fract(sin(q.x) * 43758.5453);
}

// Simple value noise
fn noise(p: vec2f) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash(i + vec2f(0.0, 0.0));
    let b = hash(i + vec2f(1.0, 0.0));
    let c = hash(i + vec2f(0.0, 1.0));
    let d = hash(i + vec2f(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Realistic, subtle thin-film interference
fn thinFilm(cosTheta: f32, thickness: f32) -> vec3f {
    // Optical path difference
    let opd = thickness * 4.0 * cosTheta;
    
    // Instead of full RGB sin waves, we create a very specific, muted color spectrum (cyan/magenta/yellow)
    let r = 0.5 + 0.5 * sin(opd * 8.0);
    let g = 0.5 + 0.5 * sin(opd * 8.5 + 1.0);
    let b = 0.5 + 0.5 * sin(opd * 9.0 + 2.0);
    
    let rawIridescence = vec3f(r, g, b);
    
    // Desaturate the rainbow heavily (mix with a neutral grey/brown)
    let luminance = dot(rawIridescence, vec3f(0.299, 0.587, 0.114));
    let muted = mix(vec3f(luminance), rawIridescence, 0.4); // Only 40% saturation
    
    return muted;
}

@fragment
fn fs(in: Out) -> @location(0) vec4f {
    // 1. Procedural Splatter Mask
    let localUV = in.original_uv - vec2f(0.5);
    let dist = length(localUV);
    let angle = atan2(localUV.y, localUV.x);
    
    // Sample noise seamlessly in a circle
    let noise_coord = vec2f(cos(angle), sin(angle)) * 3.0;
    let n = noise(noise_coord + vec2f(obj.time * 0.1)); 
    
    // Distort circle boundary (Splat shape - reduced by another 10%)
    let radius = 0.28 + n * 0.12;
    
    // Hard edge thresholding
    let alphaMask = smoothstep(radius + 0.01, radius - 0.01, dist);
    
    if (alphaMask < 0.05) {
        discard;
    }

    // 2. Oil / Gasoline Material
    let viewDir = normalize(global.viewPos.xyz - in.wp);
    let nDir = normalize(in.n);
    let NdotV = max(dot(nDir, viewDir), 0.0);
    
    // Base dark brownish/black liquid (very dark)
    let baseColor = vec3f(0.02, 0.02, 0.015);
    let swirl = noise(in.wp.xz * 4.0 + obj.time * 0.1);
    let thickness = 0.5 + swirl * 0.5;
    
    let iridescence = thinFilm(NdotV, thickness);
    
    // Fresnel for reflection strength
    let fresnel = pow(1.0 - NdotV, 4.0);
    
    // The trick: The rainbow should ONLY be visible where it reflects light (Fresnel), 
    // and even then, it's just a subtle tint over the base color, not a full replacement.
    // We mix the base color with the iridescence, but max out at 30% intensity.
    let blendFactor = fresnel * 0.3;
    let finalColor = mix(baseColor, iridescence, blendFactor);
    
    // Lighting
    var lightIntensity = 0.0;
    let lightDir = normalize(vec3f(1.0, 1.0, 1.0));
    let NdotL = max(dot(nDir, lightDir), 0.0);
    lightIntensity += NdotL * 0.5;
    
    let halfVector = normalize(lightDir + viewDir);
    let NdotH = max(dot(nDir, halfVector), 0.0);
    let specular = pow(NdotH, 128.0) * 0.8;
    
    let litColor = finalColor * (0.2 + lightIntensity) + vec3f(1.0) * specular;
    
    // Output with transparency (alphaMask)
    // Linear shading: encode with the forward pass's gamma lane like every lit shader (ADR 0049).
    return vec4f(pow(max(litColor, vec3f(0.0)), vec3f(1.0 / global.gamma)), alphaMask * 0.9);
}
`;

export class OilPuddleMaterial extends AbstractMaterial {
  public time: number = 0;

  private _ripple1 = [0, 0, 0, 0];
  private _ripple2 = [0, 0, 0, 0];
  private _ripple3 = [0, 0, 0, 0];

  constructor() {
    super("OIL_PUDDLE");
    this.transparent = true;
  }

  public addRipple(x: number, z: number, amplitude: number = 0.5): void {
    this._ripple3 = [...this._ripple2];
    this._ripple2 = [...this._ripple1];
    this._ripple1 = [x, z, this.time, amplitude];
  }

  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
    }
    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;

    props["u_time"] = this.time;
    props["u_extraParams"] = this._ripple1;
    props["u_liquidParams"] = this._ripple2;
    props["u_thresholds"] = this._ripple3;

    return this._renderManifest;
  }

  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: "OIL_PUDDLE",
      sources: {
        glsl300: { vs: "", fs: "" },
        glsl100: { vs: "", fs: "" },
        wgsl: `${vertWGSL}\n${fragWGSL}`,
      },
      layout: StandardWebGPULayout,
    };
  }
}
