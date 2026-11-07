// Line-caster shadow expansion (ADR 0045): draws each edge of a LINE_LIST caster as a quad of a
// fixed world width into the shadow map, instead of a 1-texel line. Vertex layout comes from
// LineShadowRibbon: pos = this endpoint, normal slot = the opposite endpoint, uv slot = (side ±1,
// +1 at A / -1 at B). obj.extraParams = [1, alphaTest, one texel in NDC, half width in meters].
@vertex fn vs(
    @location(0) pos: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) tangent: vec3f,
    @location(4) joints: vec4f,
    @location(5) weights: vec4f
) -> Out {
    var o: Out;

    let worldPos = obj.model * vec4f(pos, 1.0);
    let clipSelf = view.vp * worldPos;
    let clipOther = view.vp * (obj.model * vec4f(normal, 1.0));

    // Edge direction A->B in NDC; the shadow map is square, so NDC units are isotropic texels.
    // An edge pointing straight at the light collapses to a point and keeps an arbitrary axis.
    let d = (clipOther.xy / clipOther.w - clipSelf.xy / clipSelf.w) * uv.y;
    let len = length(d);
    let dir = select(vec2f(1.0, 0.0), d / len, len > 1e-6);
    let side = vec2f(-dir.y, dir.x) * uv.x;

    // World -> clip scale per axis is the length of the matching vp row: exact for the ortho
    // cascades, and for a perspective spot the divide by w scales it to the edge's depth.
    let scaleX = length(vec3f(view.vp[0][0], view.vp[1][0], view.vp[2][0]));
    let scaleY = length(vec3f(view.vp[0][1], view.vp[1][1], view.vp[2][1]));
    let halfWidth = obj.extraParams.w;
    // Never thinner than 1.5 texels, so a sub-texel wire still rasterizes without gaps.
    let minHalf = 0.75 * obj.extraParams.z * clipSelf.w;
    let offset = vec2f(max(halfWidth * scaleX, minHalf), max(halfWidth * scaleY, minHalf)) * side;

    o.pos = vec4f(clipSelf.xy + offset, clipSelf.zw);
    o.wp = worldPos.xyz;
    o.n = vec3f(0.0, 1.0, 0.0);
    o.t = vec3f(1.0, 0.0, 0.0);
    o.b = vec3f(0.0, 0.0, 1.0);
    o.uv = vec2f(0.0);
    o.original_uv = vec2f(0.0);
    return o;
}
