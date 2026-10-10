export const IBLShaders = {
  // Shared Vertex Shader for rendering a fullscreen quad (we pass the face direction from CPU or use UVs)
  // Instead of a simple fullscreen quad, we render a Cube for each face, so we get local 3D positions.
  cubeVertexShader: `#version 300 es
    layout (location = 0) in vec3 a_position;
    
    uniform mat4 u_projection;
    uniform mat4 u_view;
    
    out vec3 v_worldPos;
    
    void main() {
      v_worldPos = a_position;
      gl_Position = u_projection * u_view * vec4(a_position, 1.0);
    }
  `,

  // 1. Equirectangular to Cubemap
  equirectangularFragmentShader: `#version 300 es
    precision highp float;
    
    out vec4 FragColor;
    in vec3 v_worldPos;
    
    uniform sampler2D u_equirectangularMap;
    
    const vec2 invAtan = vec2(0.1591, 0.3183);
    
    vec2 SampleSphericalMap(vec3 v) {
      vec2 uv = vec2(atan(v.z, v.x), asin(v.y));
      uv *= invAtan;
      uv += 0.5;
      return uv;
    }
    
    void main() {
      vec2 uv = SampleSphericalMap(normalize(v_worldPos));
      vec3 color = texture(u_equirectangularMap, uv).rgb;
      FragColor = vec4(color, 1.0);
    }
  `,

  // 2. Irradiance (Diffuse Convolution)
  irradianceFragmentShader: `#version 300 es
    precision highp float;
    
    out vec4 FragColor;
    in vec3 v_worldPos;
    
    uniform samplerCube u_environmentMap;
    
    const float PI = 3.14159265359;
    
    void main() {
      vec3 N = normalize(v_worldPos);
      vec3 irradiance = vec3(0.0);
      
      // Tangent space calculation from normal
      vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 right = normalize(cross(up, N));
      up = normalize(cross(N, right));
      
      float sampleDelta = 0.1;
      float nrSamples = 0.0;
      
      for(float phi = 0.0; phi < 2.0 * PI; phi += 0.1) {
        for(float theta = 0.0; theta < 0.5 * PI; theta += 0.1) {
          // Spherical to cartesian (in tangent space)
          vec3 tangentSample = vec3(sin(theta) * cos(phi),  sin(theta) * sin(phi), cos(theta));
          // Tangent space to world
          vec3 sampleVec = tangentSample.x * right + tangentSample.y * up + tangentSample.z * N;
          
          irradiance += texture(u_environmentMap, sampleVec).rgb * cos(theta) * sin(theta);
          nrSamples += 1.0;
        }
      }
      
      irradiance = PI * irradiance * (1.0 / nrSamples);
      FragColor = vec4(irradiance, 1.0);
    }
  `,

  // 3. GGX Prefilter
  prefilterFragmentShader: `#version 300 es
    precision highp float;
    
    out vec4 FragColor;
    in vec3 v_worldPos;
    
    uniform samplerCube u_environmentMap;
    uniform float u_roughness;
    uniform float u_resolution; // Resolution of source cubemap (e.g., 512.0)
    
    const float PI = 3.14159265359;
    
    // Radical inverse based on http://holger.dammertz.org/stuff/notes_HammersleyOnHemisphere.html
    float RadicalInverse_VdC(uint bits) {
      bits = (bits << 16u) | (bits >> 16u);
      bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
      bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
      bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
      bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
      return float(bits) * 2.3283064365386963e-10; // / 0x100000000
    }
    
    vec2 Hammersley(uint i, uint N) {
      return vec2(float(i)/float(N), RadicalInverse_VdC(i));
    }
    
    vec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float roughness) {
      float a = roughness*roughness;
      
      float phi = 2.0 * PI * Xi.x;
      float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));
      float sinTheta = sqrt(1.0 - cosTheta*cosTheta);
      
      vec3 H;
      H.x = cos(phi) * sinTheta;
      H.y = sin(phi) * sinTheta;
      H.z = cosTheta;
      
      vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      vec3 tangent = normalize(cross(up, N));
      vec3 bitangent = cross(N, tangent);
      
      vec3 sampleVec = tangent * H.x + bitangent * H.y + N * H.z;
      return normalize(sampleVec);
    }
    
    void main() {
      vec3 N = normalize(v_worldPos);
      vec3 R = N;
      vec3 V = R;
      
      const uint SAMPLE_COUNT = 1024u; // WebGL safe size
      vec3 prefilteredColor = vec3(0.0);
      float totalWeight = 0.0;
      
      for(uint i = 0u; i < SAMPLE_COUNT; ++i) {
        vec2 Xi = Hammersley(i, SAMPLE_COUNT);
        vec3 H = ImportanceSampleGGX(Xi, N, u_roughness);
        vec3 L = normalize(2.0 * dot(V, H) * H - V);
        
        float NdotL = max(dot(N, L), 0.0);
        if(NdotL > 0.0) {
          // Optional: Sample from appropriate Mip level of envMap based on PDF to reduce fireflies
          prefilteredColor += texture(u_environmentMap, L).rgb * NdotL;
          totalWeight += NdotL;
        }
      }
      
      prefilteredColor = prefilteredColor / totalWeight;
      FragColor = vec4(prefilteredColor, 1.0);
    }
  `,

  // 4. BRDF LUT (Fullscreen 2D pass, no Cube)
  brdfVertexShader: `#version 300 es
    layout (location = 0) in vec2 a_position;
    layout (location = 1) in vec2 a_texcoord;
    
    out vec2 v_texcoord;
    
    void main() {
      v_texcoord = a_texcoord;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `,

  brdfFragmentShader: `#version 300 es
    precision highp float;
    
    out vec4 FragColor;
    in vec2 v_texcoord;
    
    const float PI = 3.14159265359;
    
    float RadicalInverse_VdC(uint bits) {
      bits = (bits << 16u) | (bits >> 16u);
      bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
      bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
      bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
      bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
      return float(bits) * 2.3283064365386963e-10;
    }
    
    vec2 Hammersley(uint i, uint N) {
      return vec2(float(i)/float(N), RadicalInverse_VdC(i));
    }
    
    vec3 ImportanceSampleGGX(vec2 Xi, vec3 N, float roughness) {
      float a = roughness*roughness;
      
      float phi = 2.0 * PI * Xi.x;
      float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a*a - 1.0) * Xi.y));
      float sinTheta = sqrt(1.0 - cosTheta*cosTheta);
      
      vec3 H;
      H.x = cos(phi) * sinTheta;
      H.y = sin(phi) * sinTheta;
      H.z = cosTheta;
      
      vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      vec3 tangent = normalize(cross(up, N));
      vec3 bitangent = cross(N, tangent);
      
      vec3 sampleVec = tangent * H.x + bitangent * H.y + N * H.z;
      return normalize(sampleVec);
    }
    
    float GeometrySchlickGGX(float NdotV, float roughness) {
      // Note: for IBL, k is different than direct lighting
      float a = roughness;
      float k = (a * a) / 2.0;
      float nom   = NdotV;
      float denom = NdotV * (1.0 - k) + k;
      return nom / denom;
    }
    
    float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
      float NdotV = max(dot(N, V), 0.0);
      float NdotL = max(dot(N, L), 0.0);
      float ggx2 = GeometrySchlickGGX(NdotV, roughness);
      float ggx1 = GeometrySchlickGGX(NdotL, roughness);
      return ggx1 * ggx2;
    }
    
    vec2 IntegrateBRDF(float NdotV, float roughness) {
      vec3 V;
      V.x = sqrt(1.0 - NdotV*NdotV);
      V.y = 0.0;
      V.z = NdotV;
      
      float A = 0.0;
      float B = 0.0; 
      
      vec3 N = vec3(0.0, 0.0, 1.0);
      
      const uint SAMPLE_COUNT = 1024u;
      for(uint i = 0u; i < SAMPLE_COUNT; ++i) {
        vec2 Xi = Hammersley(i, SAMPLE_COUNT);
        vec3 H = ImportanceSampleGGX(Xi, N, roughness);
        vec3 L = normalize(2.0 * dot(V, H) * H - V);
        
        float NdotL = max(L.z, 0.0);
        float NdotH = max(H.z, 0.0);
        float VdotH = max(dot(V, H), 0.0);
        
        if(NdotL > 0.0) {
          float G = GeometrySmith(N, V, L, roughness);
          float G_Vis = (G * VdotH) / (NdotH * NdotV);
          float Fc = pow(1.0 - VdotH, 5.0);
          
          A += (1.0 - Fc) * G_Vis;
          B += Fc * G_Vis;
        }
      }
      A /= float(SAMPLE_COUNT);
      B /= float(SAMPLE_COUNT);
      return vec2(A, B);
    }
    
    void main() {
      // v_texcoord.x = NdotV, v_texcoord.y = roughness
      vec2 integratedBRDF = IntegrateBRDF(v_texcoord.x, v_texcoord.y);
      FragColor = vec4(integratedBRDF, 0.0, 1.0);
    }
  `,
};
