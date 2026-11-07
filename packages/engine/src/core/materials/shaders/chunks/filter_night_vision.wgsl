var luma = dot(srgb, vec3f(0.299, 0.587, 0.114));
let scanline = sin(distortUv.y * 350.0 + u_time * 12.0) * 0.08;
luma -= scanline;
let flicker = 1.0 + (sin(u_time * 40.0) * cos(u_time * 25.0) * 0.03);
luma *= flicker;

let noise = random(distortUv + vec2f(u_time, -u_time));
if (noise > 0.99) {
    luma += 0.25;
}

srgb = vec3f(luma * 0.12, luma * 1.6, luma * 0.25);
