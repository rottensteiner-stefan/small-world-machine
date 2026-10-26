@fragment fn fs(i: Out) -> @location(0) vec4f {
    return vec4f(displayToTarget(obj.color.rgb), obj.color.a);
}