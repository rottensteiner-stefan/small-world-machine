float glitchTime = u_time * 3.0;
float blockNoise = step(0.92, random(vec2(floor(uv.y * 12.0), floor(glitchTime * 6.0))));
float glitchOffset = blockNoise * (random(vec2(floor(uv.y * 8.0), floor(glitchTime))) - 0.5) * 0.05;
float scanJitter = sin(uv.y * 10.0 + u_time * 20.0) * 0.003 * step(0.95, sin(u_time * 2.0));
distortUv.x += glitchOffset + scanJitter;
