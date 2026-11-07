float projFlicker = 0.85 + 0.15 * random(vec2(u_time * 25.0, 9.0));
srgb *= projFlicker;
float luma = dot(srgb, vec3(0.299, 0.587, 0.114));
srgb = vec3(luma * 1.15, luma * 0.95, luma * 0.75);

float scratchX = random(vec2(floor(u_time * 8.0), 12.0));
float scratchWidth = 0.0012;
float isScratch = step(scratchX, distortUv.x) * step(distortUv.x, scratchX + scratchWidth);
float scratchVis = step(0.65, random(vec2(floor(u_time * 4.0), 13.0)));
float scratchIntensity = isScratch * scratchVis * (0.4 + 0.6 * random(distortUv + u_time));
srgb = mix(srgb, vec3(1.0), scratchIntensity);

float spotFrame = floor(u_time * 12.0);
vec2 spotPos = vec2(random(vec2(spotFrame, 14.0)), random(vec2(spotFrame, 15.0)));
float spotRadius = 0.006 + 0.012 * random(vec2(spotFrame, 16.0));
float distToSpot = distance(distortUv, spotPos);
float isSpot = step(distToSpot, spotRadius) * step(0.82, random(vec2(spotFrame, 17.0)));

float hairSeed = random(vec2(spotFrame, 18.0));
float isHair = 0.0;
if (hairSeed > 0.80) {
    float hairX = spotPos.x + sin(distortUv.y * 60.0 + spotFrame) * 0.004;
    float hairWidth = 0.0008;
    isHair = step(hairX - hairWidth, distortUv.x) * step(distortUv.x, hairX + hairWidth) * step(abs(distortUv.y - spotPos.y), 0.06);
}
float dirtColor = max(isSpot, isHair);
srgb = mix(srgb, vec3(random(vec2(spotFrame)) > 0.5 ? 0.05 : 0.95), dirtColor);
