#ifdef GL_ES
precision mediump float;
#endif

void main( void ) {
    vec2 p = ( gl_FragCoord.xy / resolution.xy ) * 2.0 - 1.0;
    p.x *= resolution.x / resolution.y;
    
    vec3 col = vec3(0.0);
    for(float i=1.0; i<4.0; i++) {
        vec2 newp = p;
        newp.x += 0.6 / i * cos(i * p.y + time + 0.3);
        newp.y += 0.6 / i * cos(i * p.x + time + 0.3);
        p = newp;
    }
    
    col = vec3(0.5 * sin(3.0 * p.x) + 0.5,
               0.5 * sin(3.0 * p.y) + 0.5,
               sin(p.x + p.y));
               
    gl_FragColor = vec4(col, 1.0);
}
