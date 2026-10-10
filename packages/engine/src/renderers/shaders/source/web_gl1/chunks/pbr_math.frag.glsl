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
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Linear to sRGB
vec3 linearToSRGB(vec3 color) {
    return pow(color, vec3(1.0 / 2.2));
}

// sRGB to Linear
vec3 sRGBToLinear(vec3 color) {
    return pow(color, vec3(2.2));
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

