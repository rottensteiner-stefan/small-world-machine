# Clustered/Tiled Forward+ Lighting: feste Kapazitäts-Grid, Kapazitätserhöhung nur auf WebGPU

Clustered Light Culling gibt es nur für WebGPU (compute-basiert) und WebGL2
(CPU-Culling + Integer-Textur-Lookup); WebGL1 behält die alte flache 16-Licht-Schleife unverändert
bei, ganz ohne Clustering-Pfad — es hat weder Compute-Shader noch `texelFetch`/Integer-Texturen,
und Godots eigenes Forward+-Volumetric-Fog (ein eng verwandtes Feature) zieht auf seinen
Mobile-/Compatibility-Renderern aus demselben Grund dieselbe Grenze.

WebGL2s CPU-Culling testet nicht jede Cluster-Zelle gegen jedes Licht (das wären bei der
Standard-Grid-Größe ~190k Zellen x 16 Lichter pro Frame in JS) — für jedes Licht wird zuerst ein
Screen-Space- + Radialdistanz-Abdeckungsbereich berechnet (`lightClusterCoverage()` in
`packages/engine/src/math/ClusterGrid.ts`, dieselbe Formel, die `cluster_cull.wgsl`s `lightCoverage()` auf WebGPU
verwendet), und nur die Zellen innerhalb dieses Bereichs werden besucht. Beide Backends teilen sich
also einen Licht-gegen-Cluster-Test, nur auf verschiedenen Seiten der GPU-/CPU-Grenze und in
unterschiedlicher Schleifenreihenfolge ausgeführt (WebGPU: ein Thread pro Zelle, Schleife über
Lichter; WebGL2: eine JS-Iteration pro Licht, Schleife über dessen eigenen Zellbereich).

Jede Cluster-Zelle bekommt einen **Slot fester Größe** (`maxLightsPerCluster`, Standard 32) für
Licht-Indizes plus einen Zähler — keine Atomics, kein dynamisches Wachstum pro Cluster. Atomics
existieren in WebGL2s Shader-Modell überhaupt nicht, ein atomics-basiertes Design würde WebGPU und
WebGL2 also auf architektonisch unterschiedliche Cluster-Repräsentationen zwingen und damit den
Sinn zunichtemachen, eine Fragment-Shader-Lookup-Formel über beide Backends hinweg zu teilen. Bei
den gewählten Grid-Standardwerten (16x16px Kacheln, 24 logarithmisch gestaffelte Z-Scheiben) hat
ein 1080p-Frame in der Größenordnung von 190k Cluster-Zellen; bei je 32 u32-Slots kommen die
Punkt- und Spot-Licht-Indexpuffer auf WebGPU auf jeweils etwa 25 MB. Das liegt innerhalb der
WebGPU-Standard-Storage-Buffer-Limits, ist aber ein echter Speicherkosten-Posten, kein
Rundungsfehler — `quality.clusteredLighting.tileSize`/`maxLightsPerCluster` für
speicherbeschränkte Zielplattformen nach unten anpassen.

Die szenenweite Punkt-/Spot-Licht-Obergrenze (`MAX_CLUSTERED_LIGHTS_PER_TYPE`, siehe
[0004](0004-point-spot-light-global-cap.md)) ging von 16 auf 64 — aber nur WebGPU verarbeitet
tatsächlich Lichter jenseits von 16. WebGL2s rohes Pro-Licht-UBO-Array (Position/Farbe/etc.) bleibt
in dieser Iteration bewusst bei seinem bestehenden 16-Slot-std140-Layout: dieses byte-genaue,
handberechnete Layout zu vergrößern *und* gleichzeitig Clustering einzuführen hätte zwei
unabhängig riskante Änderungen in eine gebündelt. Clustering auf WebGL2 reduziert daher nur die
Anzahl der Lichter, über die jedes Fragment iteriert (weniger als 16, nach Nähe ausgewählt); es
hebt WebGL2s Obergrenze nicht über 16 an. WebGL1 bleibt ebenfalls bei 16, unberührt von der
höheren szenenweiten Obergrenze (es begrenzt seinen eigenen Verbrauch explizit).

Clustering zu deaktivieren (`quality.clusteredLighting.enabled = false`) braucht keinen separaten
Shader-Codepfad: es lässt das Grid einfach zu einer einzigen 1x1x1-Zelle kollabieren, die das
gesamte Frustum abdeckt, mit `maxLightsPerCluster` auf die volle Lichter-Obergrenze angehoben —
mathematisch identisch zum alten "jedes Licht durchlaufen"-Verhalten, berechnet über exakt
denselben Cluster-Lookup-Code.

**Das hier überdenken, wenn:** eine Szene mehr als 16 gleichzeitige Lichter einer Art auf WebGL2
braucht — das erfordert eine Vergrößerung des UBO-Layouts (eine neue, eigenständig riskante
Änderung), nicht nur das Aktivieren von Clustering. Oder falls die ~25-MB-Puffer-Kosten pro
Lichttyp auf einem Zielgerät zu einer echten Einschränkung werden — zuerst `maxLightsPerCluster`
senken oder `tileSize` vergröbern, bevor irgendetwas Invasiveres angegangen wird.
