#version 300 es
precision mediump float;

out vec2 v_uv;

void main() {
    // Generate a fullscreen triangle from gl_VertexID (no VBO required)
    float x = float((gl_VertexID << 1) & 2) * 2.0 - 1.0;
    float y = float(gl_VertexID & 2) * 2.0 - 1.0;
    v_uv = vec2(x * 0.5 + 0.5, y * 0.5 + 0.5);
    gl_Position = vec4(x, y, 0.0, 1.0);
}
