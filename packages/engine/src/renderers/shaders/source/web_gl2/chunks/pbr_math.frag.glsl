// Geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019; Filament's normalFiltering, Unity HDRP
// "Geometric Specular AA"): widens the GGX lobe by the screen-space variance of the shading normal, so
// normal-map and curvature detail below pixel size stops sparkling. Perceptual roughness in and out
// (ADR 0051).
const float SPECULAR_AA_VARIANCE = 0.15; // screen-space filter kernel variance (Filament default)
const float SPECULAR_AA_THRESHOLD = 0.2; // cap on the added roughness^2 (Filament default)
// The normal map's own sub-pixel variance (Toksvig 2005, vMF form of Kaplanyan et al. 2016): mipmapped
// normals average to a shorter vector, sigma^2 = 1/kappa with kappa = (3r - r^3) / (1 - r^2). Lengths
// above 0.99 are 8-bit quantisation, not variance. `normalStrength` is the larger |normalScale|.
float specularAntiAliasing(float perceptualRoughness, vec3 n, float normalLength, float normalStrength) {
    vec3 du = dFdx(n);
    vec3 dv = dFdy(n);
    float nl = clamp(normalLength / 0.99, 0.0001, 1.0);
    float toksvig = (1.0 - nl * nl) / (3.0 * nl - nl * nl * nl) * normalStrength * normalStrength;
    float variance = SPECULAR_AA_VARIANCE * (dot(du, du) + dot(dv, dv)) + toksvig;
    float kernelRoughness = min(2.0 * variance, SPECULAR_AA_THRESHOLD);
    float r = perceptualRoughness * perceptualRoughness;
    return sqrt(sqrt(clamp(r * r + kernelRoughness, 0.0, 1.0)));
}

// GGX Normal Distribution Function
float D_GGX(float dotNH, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float denom = (dotNH * dotNH * (a2 - 1.0) + 1.0);
    return a2 / (3.14159265359 * denom * denom);
}

// Smith's Geometric Shadowing Function
float G_SchlickGGX(float dotNL, float dotNV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    float GL = dotNL / (dotNL * (1.0 - k) + k);
    float GV = dotNV / (dotNV * (1.0 - k) + k);
    return GL * GV;
}

// Fresnel Schlick
vec3 F_Schlick(float cosTheta, vec3 F0) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    return F0 + (1.0 - F0) * (x2 * x2 * x);
}

// Fresnel Schlick with roughness injected (for IBL)
vec3 F_SchlickRoughness(float cosTheta, vec3 F0, float roughness) {
    float x = clamp(1.0 - cosTheta, 0.0, 1.0);
    float x2 = x * x;
    return F0 + (max(vec3(1.0 - roughness), F0) - F0) * (x2 * x2 * x);
}

// Charlie Sheen Distribution Function (Estevez & Kulla 2017)
float D_Charlie(float dotNH, float roughness) {
    float alpha = max(roughness * roughness, 0.000001);
    float invAlpha = 1.0 / alpha;
    float cos2h = dotNH * dotNH;
    float sin2h = max(1.0 - cos2h, 0.0078125);
    return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * 3.14159265359);
}

// Neubelt Sheen Visibility Function (Neubelt & Pettineo 2013)
float V_Neubelt(float dotNL, float dotNV) {
    return 1.0 / (4.0 * (dotNL + dotNV - dotNL * dotNV) + 0.0001);
}

// Kelemen Geometric Shadowing for Clearcoat (Kelemen 2000 / Burley 2012)
float G_Kelemen(float dotVH) {
    return 0.25 / (dotVH * dotVH + 0.0001);
}

// Volumetric Beer-Lambert Attenuation (KHR_materials_volume)
vec3 VolumeAbsorption(vec3 attenuationColor, float attenuationDistance, float thickness) {
    if (attenuationDistance <= 0.0 || attenuationDistance >= 999.0) {
        return vec3(1.0);
    }
    vec3 sigma_a = -log(clamp(attenuationColor, vec3(0.001), vec3(1.0))) / attenuationDistance;
    return exp(-sigma_a * thickness);
}

