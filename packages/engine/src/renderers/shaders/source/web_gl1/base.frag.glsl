#ifdef GL_OES_standard_derivatives
#extension GL_OES_standard_derivatives : enable
#endif
precision highp float;

varying vec3 v_worldPos;
varying vec3 v_normal;
varying vec2 v_uv;
varying mat3 v_tbn;
varying vec4 v_clipPos;

#ifdef USE_INSTANCE_COLOR
varying vec4 v_instanceColor;
#endif

uniform vec4 u_color;
uniform vec4 u_specColor;
uniform float u_shininess;
uniform vec3 u_viewPos;
uniform vec4 u_extraParams;

uniform sampler2D u_diffuseMap;
uniform sampler2D u_normalMap;
uniform sampler2D u_specularMap;
