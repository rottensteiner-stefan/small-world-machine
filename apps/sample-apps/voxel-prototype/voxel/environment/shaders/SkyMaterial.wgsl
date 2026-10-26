// Voxel sky dome (M6) -- WebGPU / WGSL twin of SkyMaterial.vert/frag.glsl; keep the look in sync.
// Lanes: u_matParam0 = [sunDirection.xyz, starVisibility], u_matParam1 = [horizonColor.rgb, time],
// u_matParam2 = [zenithColor.rgb, 0]. Own output struct (not `Out`): see BlockMaterial.wgsl.
[WGSL_STRUCTS]

struct SkyOut {
    @builtin(position) pos: vec4f,
    @location(0) dir: vec3f,
}

const SUN_RADIUS: f32 = 0.045;
const MOON_RADIUS: f32 = 0.034;
const STAR_GRID: f32 = 150.0;
const STAR_DENSITY: f32 = 0.0035;

fn starHash(pIn: vec3f) -> f32 {
    var p = fract(pIn * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

@vertex fn vs(@location(0) pos: vec3f) -> SkyOut {
    var vsOut: SkyOut;
    let wp = obj.model * vec4f(pos, 0.0) + vec4f(global.viewPos.xyz, 1.0);
    let clip = view.vp * wp;
    vsOut.pos = vec4f(clip.xy, clip.w * 0.99999, clip.w);
    vsOut.dir = pos;
    return vsOut;
}

@fragment fn fs(i: SkyOut) -> @location(0) vec4f {
    let d = normalize(i.dir);
    let sunDir = normalize(obj.matParam0.xyz);
    let starVisibility = obj.matParam0.w;
    let horizon = obj.matParam1.rgb;
    let zenith = obj.matParam2.rgb;
    let time = obj.matParam1.w;

    let up = clamp(d.y, 0.0, 1.0);
    var sky = mix(horizon, zenith, pow(up, 0.5));

    let sunCos = dot(d, sunDir);
    let aboveHorizon = smoothstep(-0.03, 0.04, d.y);
    let sunVisible = smoothstep(-0.12, 0.02, sunDir.y);
    let glow = pow(max(sunCos, 0.0), 14.0) * 0.45 * sunVisible;
    sky += vec3f(1.0, 0.72, 0.42) * glow;
    let disc = smoothstep(cos(SUN_RADIUS * 1.25), cos(SUN_RADIUS), sunCos) * sunVisible;
    sky = mix(sky, vec3f(1.0, 0.97, 0.86), disc * aboveHorizon);

    let moonDir = -sunDir;
    let moonCos = dot(d, moonDir);
    let moonVisible = smoothstep(-0.12, 0.02, moonDir.y);
    let moonDisc = smoothstep(cos(MOON_RADIUS * 1.3), cos(MOON_RADIUS), moonCos) * moonVisible;
    sky = mix(sky, vec3f(0.86, 0.9, 1.0), moonDisc * aboveHorizon);

    let cell = d * STAR_GRID;
    let h = starHash(floor(cell));
    let star = step(1.0 - STAR_DENSITY, h);
    let centre = 1.0 - smoothstep(0.0, 0.42, length(fract(cell) - vec3f(0.5)));
    let twinkle = 0.65 + 0.35 * sin(time * 2.4 + h * 400.0);
    let starAlpha = star * centre * twinkle * starVisibility * smoothstep(0.02, 0.2, d.y) * (1.0 - moonDisc);
    sky += vec3f(0.9, 0.93, 1.0) * starAlpha;

    return vec4f(displayToTarget(sky), 1.0);
}
