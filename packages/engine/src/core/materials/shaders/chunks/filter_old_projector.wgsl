let projFlicker = 0.85 + 0.15 * random(vec2f(u_time * 25.0, 9.0));
srgb *= projFlicker;
let luma = dot(srgb, vec3f(0.299, 0.587, 0.114));
srgb = vec3f(luma * 1.15, luma * 0.95, luma * 0.75);

let scratchX = random(vec2f(floor(u_time * 8.0), 12.0));
let scratchWidth = 0.0012;
let isScratch = step(scratchX, distortUv.x) * step(distortUv.x, scratchX + scratchWidth);
let scratchVis = step(0.65, random(vec2f(floor(u_time * 4.0), 13.0)));
let scratchIntensity = isScratch * scratchVis * (0.4 + 0.6 * random(distortUv + vec2f(u_time)));
srgb = mix(srgb, vec3f(1.0), scratchIntensity);

let spotFrame = floor(u_time * 12.0);
let spotPos = vec2f(random(vec2f(spotFrame, 14.0)), random(vec2f(spotFrame, 15.0)));
let spotRadius = 0.006 + 0.012 * random(vec2f(spotFrame, 16.0));
let distToSpot = distance(distortUv, spotPos);
let isSpot = step(distToSpot, spotRadius) * step(0.82, random(vec2f(spotFrame, 17.0)));

let hairSeed = random(vec2f(spotFrame, 18.0));
let hairX = spotPos.x + sin(distortUv.y * 60.0 + spotFrame) * 0.004;
let hairWidth = 0.0008;
let isHair = select(0.0, step(hairX - hairWidth, distortUv.x) * step(distortUv.x, hairX + hairWidth) * step(abs(distortUv.y - spotPos.y), 0.06), hairSeed > 0.80);
let dirtColor = max(isSpot, isHair);
srgb = mix(srgb, vec3f(select(0.95, 0.05, random(vec2f(spotFrame, 19.0)) > 0.5)), dirtColor);
