[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]

uniform sampler2D u_sandMap;
uniform sampler2D u_grassMap;
uniform sampler2D u_rockMap;
uniform sampler2D u_snowMap;
uniform vec4 u_thresholds;

void main() {
  vec3 N = normalize(v_normal);
  vec4 sand = texture(u_sandMap, v_uv);
  vec4 grass = texture(u_grassMap, v_uv);
  vec4 rock = texture(u_rockMap, v_uv);
  vec4 snow = texture(u_snowMap, v_uv);

  float h = v_worldPos.y;
  float b1 = smoothstep(u_thresholds.x - u_thresholds.w, u_thresholds.x + u_thresholds.w, h);
  float b2 = smoothstep(u_thresholds.y - u_thresholds.w, u_thresholds.y + u_thresholds.w, h);
  float b3 = smoothstep(u_thresholds.z - u_thresholds.w, u_thresholds.z + u_thresholds.w, h);

  vec4 texColor = mix(sand, grass, b1);
  texColor = mix(texColor, rock, b2);
  texColor = mix(texColor, snow, b3);

  float slope = 1.0 - N.y;
  float slopeBlend = smoothstep(0.25, 0.45, slope);
  texColor = mix(texColor, rock, slopeBlend);

  [LIGHT_CALC]

  vec3 albedo = sRGBToLinear(texColor.rgb) * sRGBToLinear(u_color.rgb);
  vec3 finalColor = finalLight * albedo + specular * sRGBToLinear(u_specColor.rgb);
  
  finalColor *= u_exposure;
  if (u_gamma != 1.0) {
    finalColor = finalColor / (finalColor + vec3(1.0)); // Reinhard (the post-process pass tone-maps otherwise)
  }
  finalColor = linearToSRGB(finalColor);

  fragColor = vec4(finalColor, u_color.a * texColor.a);
}