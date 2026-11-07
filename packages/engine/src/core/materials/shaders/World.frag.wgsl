@fragment fn fs(i: Out) -> @location(0) vec4f {
  var blendWeights = abs(i.n);
  blendWeights = pow(blendWeights, vec3f(4.0));
  let totalWeight = blendWeights.x + blendWeights.y + blendWeights.z;
  blendWeights = blendWeights / totalWeight;
  var coordX = i.wp.zy * obj.texRepeat;
  var coordY = i.wp.xz * obj.texRepeat;
  var coordZ = i.wp.xy * obj.texRepeat;
  if (i.n.x < 0.0) { coordX.x = -coordX.x; }
  if (i.n.y < 0.0) { coordY.x = -coordY.x; }
  if (i.n.z >= 0.0) { coordZ.x = -coordZ.x; }
  let colX = textureSample(u_diffuseMap, s, coordX);
  let colY = textureSample(u_diffuseMap, s, coordY);
  let colZ = textureSample(u_diffuseMap, s, coordZ);
  let finalTexColor = colX * blendWeights.x + colY * blendWeights.y + colZ * blendWeights.z;
  [WGSL_LIGHTING]
  let albedo = sRGBToLinear(finalTexColor.rgb) * sRGBToLinear(obj.color.rgb);
  var color = linearToSRGB(fL * albedo * global.exposure);
  [WGSL_FOG_CALC]
  return vec4f(color, obj.color.a * finalTexColor.a);
}