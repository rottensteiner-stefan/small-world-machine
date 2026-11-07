# Punkt-/Spot-Licht-Obergrenze ist global, nicht pro Objekt

`PointLight.applyTo()`/`SpotLight.applyTo()` schreiben in ein flaches, szenenweites Array, gedeckelt
bei je 16 aktiven Lichtern (`if (16 > data.pLights.length) ...`) — keine pro-Objekt-Auswahl der
"nächsten N Lichter". Welche Lichter zuerst in der Iteration eines Frames drankommen, gewinnen;
jedes weitere Licht dieser Art in der Szene trägt still nichts bei, ohne Warnung. Wir haben die
Obergrenze in einer Session von 4 auf 16 angehoben, sind aber vor echter distanzbasierter Auswahl
pro Objekt stehengeblieben: das würde drei verschiedene Upload-Mechanismen betreffen (WebGL2s
UBO-Subrange pro Objekt, WebGL1s Uniform-Re-Upload pro Objekt, WebGPUs
Storage-Buffer-Indizierung pro Objekt) und ist ein wesentlich größeres Projekt — praktisch die
Vorstufe zu vollem Clustered/Tiled-Forward+-Lighting, kein kleiner Folgeauftrag. Die Obergrenze ist
außerdem im Shader-Quellcode aller drei Backends fest verankert (`u_pointLights[16]`/
`u_spotLights[16]`), sodass eine erneute Anhebung WebGL2s UBO-Byte-Layout, WebGL1s Uniform-Arrays
und (günstig, da dort schon dynamisch) WebGPU betrifft.

**Das hier überdenken, wenn:** eine Szene mehr als 16 gleichzeitige Lichter einer Art braucht, oder
Lichter nach tatsächlicher Nähe zu jedem Objekt statt nach Szenen-Traversierungsreihenfolge
ausgewählt werden müssen — echte Zeit einplanen, entweder für eine koordinierte Anhebung der
Obergrenze über alle drei Renderer hinweg, oder für das oben beschriebene
Pro-Objekt-Auswahl-Projekt.

**Update:** das Pro-Objekt-Auswahl-Projekt ist passiert — siehe
[0007](0007-clustered-lighting-webgl2-webgpu-only.md). Die szenenweite Obergrenze liegt jetzt bei
64, aber nur WebGPU verarbeitet Lichter jenseits von 16 (pro Cluster nach Nähe ausgewählt);
WebGL2/WebGL1 lesen weiterhin nur die ersten 16.
