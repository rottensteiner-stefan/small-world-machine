// ImpastoStroke.frag.wgsl
// Interactive palette-knife impasto: height field = paint coverage (u_diffuseMap.a),
// stroke direction/pressure = u_emissiveMap, background layer = u_aoMap.
@fragment fn fs(i: Out) -> @location(0) vec4f {
    let brushRelief = obj.matParam0.x;
    let smearDist   = obj.matParam0.y;
    let edgeLift    = obj.matParam0.z;
    let paintOpacity= obj.matParam0.w;
    let invW = max(obj.matParam1.x, 1e-6);
    let invH = max(obj.matParam1.y, 1e-6);
    let texel = vec2f(invW, invH);

    let paint  = textureSample(u_diffuseMap, s, i.uv);
    let dirTex = textureSample(u_emissiveMap, s, i.uv);
    let baseTex = textureSample(u_aoMap, s, i.uv);

    let coverage = clamp(paint.a, 0.0, 1.0);
    // Stroke direction decoded from 0..1 storage into plane-UV space.
    let dirU = clamp(dirTex.r * 2.0 - 1.0, -1.0, 1.0);
    let dirV = clamp(dirTex.g * 2.0 - 1.0, -1.0, 1.0);
    let pressure = clamp(dirTex.a, 0.0, 1.0);
    let lift = clamp(dirTex.b, 0.0, 1.0);

    // Height-field gradient (finite differences on coverage) in plane-UV space.
    let hPx = textureSample(u_diffuseMap, s, i.uv + vec2f(texel.x, 0.0)).a;
    let hNx = textureSample(u_diffuseMap, s, i.uv - vec2f(texel.x, 0.0)).a;
    let hPy = textureSample(u_diffuseMap, s, i.uv + vec2f(0.0, texel.y)).a;
    let hNy = textureSample(u_diffuseMap, s, i.uv - vec2f(0.0, texel.y)).a;
    let gX = hPx - hNx;
    let gY = hPy - hNy;

    // Directional palette-knife smear: pull paint color a few texels along the travel so a
    // hard stroke visibly drags pigment instead of painting a pure stamp.
    let smearPx = (1.0 - pressure) * (2.0 + 40.0 * smearDist);
    let smearUv = vec2f(dirU, dirV) * (smearPx * texel);
    let smear = textureSample(u_diffuseMap, s, clamp(i.uv + smearUv, vec2f(0.0), vec2f(1.0)));
    var paintColor = mix(paint.rgb, smear.rgb, smoothstep(0.3, 0.9, smearDist) * 0.7);
    let paintAlpha = coverage * paintOpacity;

    // Impasto normal perturbation: the painted height slopes the surface toward the light.
    let N = normalize(i.n);
    let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(N.y) < 0.999);
    let T = normalize(cross(up, N));
    let B = cross(N, T);
    let reliefScale = brushRelief * (1.0 + 2.0 * coverage);
    let perturbedN = normalize(N + (T * (-gX) + B * (-gY)) * reliefScale * 3.0);

    // STYLIZED (not physically based, by design): ignores scene lights/shadows/IBL and uses its own key
    // light (lane matParam2.xyz, default (0.4, 0.7, 0.5)). Energy is bounded: diffuse <= albedo,
    // metallic darkens diffuse, specular and result are clamped to 1.
    let L = normalize(obj.matParam2.xyz);
    let V = normalize(global.viewPos.xyz - i.wp);
    let H = normalize(L + V);
    let NdotL = max(dot(perturbedN, L), 0.0);
    let NdotH = max(dot(perturbedN, H), 0.0);
    let specPower = mix(12.0, 128.0, 1.0 - obj.roughness);
    let spec = pow(NdotH, specPower) * (1.0 - obj.roughness);

    // Raised rim along the painted stroke edge.
    let edgeFactor = lift * coverage;
    var specColor = mix(vec3f(0.35), vec3f(1.0, 0.98, 0.95), obj.metallic);
    specColor = min(specColor + vec3f(0.8) * (edgeFactor * edgeLift), vec3f(1.0));

    let metalK = vec3f(1.0 - 0.5 * obj.metallic);
    let baseShaded = baseTex.rgb * (vec3f(0.42) + vec3f(0.58) * NdotL);
    let paintShaded = paintColor * (vec3f(0.35) + vec3f(0.65) * NdotL) * metalK
        + specColor * spec * select(0.0, 1.0, NdotL > 0.0);

    var color = mix(baseShaded, paintShaded, clamp(paintAlpha * 1.4, 0.0, 1.0));
    color += specColor * (spec * edgeFactor * 0.6);
    color = min(color, vec3f(1.0));
    [WGSL_FOG_CALC]

    return vec4f(color, 1.0);
}
