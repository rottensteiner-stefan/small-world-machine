let jitterTime = u_time * 15.0;
let jitter = (random(vec2f(jitterTime, uv.y)) - 0.5) * 0.003 * step(0.97, random(vec2f(jitterTime)));
let tracking = step(0.92, sin(uv.y * 3.5 - u_time * 1.2));
let trackingDistort = tracking * (random(vec2f(uv.y, u_time)) - 0.5) * 0.012;
distortUv.x += jitter + trackingDistort;

let bounce = step(0.98, sin(u_time * 0.5)) * (random(vec2f(u_time)) - 0.5) * 0.01;
distortUv.y += bounce;
