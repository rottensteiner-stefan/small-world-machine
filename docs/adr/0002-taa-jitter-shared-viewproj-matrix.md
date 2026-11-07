# TAA-Jitter wird in die gemeinsame View-Projection-Matrix eingebacken, nicht in eine separate

`Camera.jitterX`/`jitterY` werden direkt in `Camera._viewProjMatrix` innerhalb von
`updateViewMatrix()` addiert — dieselbe Matrix, die auch für Culling (`FrustumCuller`) verwendet
wird und von HBAOs View-Space-Rekonstruktion gelesen wird. Wir haben keine zweite, ungejitterte
Matrix für diese anderen Konsumenten eingeführt. Die Begründung: TAAs Subpixel-Jitter (deutlich
unter einem Texel) ist für Frustum-Culling vernachlässigbar (kein nennenswertes Risiko, ein Objekt
fälschlich zu culen oder zu behalten) und für HBAOs Tiefen-Rekonstruktion (der resultierende
Occlusion-Fehler ist nicht wahrnehmbar) — eine zweite Matrix zu berechnen und durch jeden Frame zu
schleusen, für jede Kamera, jeden Shadow-Pass, jeden AO-Pass, hätte nichts gebracht.
Shadow-Map-Matrizen sind so oder so nicht betroffen, da sie aus der eigenen Kamera jedes Lichts
stammen, nie aus der `_viewProjMatrix` der Hauptkamera.

**Das hier überdenken, wenn:** ein zukünftiger Effekt die View-Projection-Matrix so liest, dass
Subpixel-Fehler tatsächlich eine Rolle spielen (z. B. präzises Screen-Space-Picking mit
Subpixel-Genauigkeit), oder falls TAAs Jitter-Amplitude jemals über etwa ein Texel hinaus erhöht
wird.
