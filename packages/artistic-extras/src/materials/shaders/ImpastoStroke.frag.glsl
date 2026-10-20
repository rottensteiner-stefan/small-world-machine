[BASE_FRAGMENT_HEADER]

uniform vec4 u_styleA;
uniform vec4 u_styleB;
uniform float u_time;
uniform float u_metallic;
uniform float u_roughness;
uniform sampler2D u_emissiveMap;
uniform sampler2D u_aoMap;

void main() {
    float brushRelief = u_styleA.x;
    float smearDist   = u_styleA.y;
    float edgeLift    = u_styleA.z;
    float paintOpacity= u_styleA.w;
    float invW = max(u_styleB.x, 1e-6);
    float invH = max(u_styleB.y, 1e-6);
    vec2 texel = vec2(invW, invH);

    vec4 paint  = texture(u_diffuseMap, v_uv);
    vec4 dirTex = texture(u_emissiveMap, v_uv);
    vec4 baseTex = texture(u_aoMap, v_uv);

    float coverage = clamp(paint.a, 0.0, 1.0);
    float dirU = clamp(dirTex.r * 2.0 - 1.0, -1.0, 1.0);
    float dirV = clamp(dirTex.g * 2.0 - 1.0, -1.0, 1.0);
    float pressure = clamp(dirTex.a, 0.0, 1.0);
    float lift = clamp(dirTex.b, 0.0, 1.0);

    float hPx = texture(u_diffuseMap, v_uv + vec2(texel.x, 0.0)).a;
    float hNx = texture(u_diffuseMap, v_uv - vec2(texel.x, 0.0)).a;
    float hPy = texture(u_diffuseMap, v_uv + vec2(0.0, texel.y)).a;
    float hNy = texture(u_diffuseMap, v_uv - vec2(0.0, texel.y)).a;
    float gX = hPx - hNx;
    float gY = hPy - hNy;

    float smearPx = (1.0 - pressure) * (2.0 + 40.0 * smearDist);
    vec2 smearUv = vec2(dirU, dirV) * (smearPx * texel);
    vec4 smear = texture(u_diffuseMap, clamp(v_uv + smearUv, 0.0, 1.0));
    vec3 paintColor = mix(paint.rgb, smear.rgb, smoothstep(0.3, 0.9, smearDist) * 0.7);
    float paintAlpha = coverage * paintOpacity;

    vec3 N = normalize(v_normal);
    vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T = normalize(cross(up, N));
    vec3 B = cross(N, T);
    float reliefScale = brushRelief * (1.0 + 2.0 * coverage);
    vec3 perturbedN = normalize(N + (T * (-gX) + B * (-gY)) * reliefScale * 3.0);

    vec3 L = normalize(vec3(0.4, 0.7, 0.5));
    vec3 V = normalize(-v_worldPos);
    vec3 H = normalize(L + V);
    float NdotL = max(dot(perturbedN, L), 0.0);
    float NdotH = max(dot(perturbedN, H), 0.0);
    float specPower = mix(12.0, 128.0, 1.0 - u_roughness);
    float spec = pow(NdotH, specPower) * (1.0 - u_roughness);

    float edgeFactor = lift * coverage;
    vec3 specColor = mix(vec3(0.35), vec3(1.0, 0.98, 0.95), u_metallic);
    specColor += vec3(0.8) * (edgeFactor * edgeLift);

    vec3 baseShaded = baseTex.rgb * (vec3(0.42) + vec3(0.8) * NdotL);
    vec3 paintShaded = paintColor * (vec3(0.35) + vec3(0.85) * NdotL)
        + specColor * spec * step(0.0, NdotL);

    vec3 color = mix(baseShaded, paintShaded, clamp(paintAlpha * 1.4, 0.0, 1.0));
    color += specColor * (spec * edgeFactor * 0.6);

    fragColor = vec4(color, 1.0);
}
