[BASE_FRAGMENT_HEADER]
[LIGHT_DEFS]
void main() {
  fragColor = vec4(displayToTarget(u_color.rgb), u_color.a);
}