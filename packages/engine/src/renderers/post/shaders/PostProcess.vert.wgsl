struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) id: u32) -> VertexOutput {
    // Generate a fullscreen triangle from vertex index alone.
    // 3 vertices cover the entire clip space.
    let x = f32((id << 1u) & 2u) * 2.0 - 1.0;
    let y = f32(id & 2u) * 2.0 - 1.0;
    var out: VertexOutput;
    out.position = vec4f(x, y, 0.0, 1.0);
    out.uv = vec2f(x * 0.5 + 0.5, 0.5 - y * 0.5);
    return out;
}
