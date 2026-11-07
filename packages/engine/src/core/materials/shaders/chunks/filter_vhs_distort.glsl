float jitterTime = u_time * 15.0;
float jitter = (random(vec2(jitterTime, uv.y)) - 0.5) * 0.003 * step(0.97, random(vec2(jitterTime)));
float tracking = step(0.92, sin(uv.y * 3.5 - u_time * 1.2));
float trackingDistort = tracking * (random(vec2(uv.y, u_time)) - 0.5) * 0.012;
distortUv.x += jitter + trackingDistort;

float bounce = step(0.98, sin(u_time * 0.5)) * (random(vec2(u_time)) - 0.5) * 0.01;
distortUv.y += bounce;
