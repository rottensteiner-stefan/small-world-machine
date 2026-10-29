# Showcase 20: Built-in Behaviors — Development Log

## 2026-10-29: Behavior Lab HUD & Geometrie- / Hot-Path-Sanierung

### 1. Befund & Motivation
Showcase 20 demonstriert fertige `Behavior`-Komponenten (`BobbingBehavior`, `RotatorBehavior`, `RainbowBehavior`, `PathFollowerBehavior`, `FlickerBehavior`, `SpringLerpBehavior`, `LookAtBehavior`) in einer Synthwave/Tron-Szene. Eine Überprüfung deckte folgende Mängel auf:
* **Verkehrte Raumschiff-Ausrichtung:** Der `Cone` (Spitze bei `+Y`, Basis bei `-Y`) wurde mit `rotation.x = Math.PI / 2` rotiert. Im rechtshändigen SWM-System (`-Z` = Vorne, `+Z` = Hinten) zeigte die Spitze dadurch nach `+Z` (nach hinten ins Triebwerk), und die flache Scheibe flog nach vorne. Das Schiff flog rückwärts.
* **Schatten-Placebo auf dem Boden:** `floor.material` war `BasicMaterial` (unlit, keine Beleuchtungs-/Schattenberechnung). Das anschließende `floor.receiveShadow = true;` war wirkungslos, und auch das Spotlight zeichnete keinen Lichtkegel auf den Boden.
* **Companion Hot-Path GC & falscher Achsen-Offset:** Das anonyme Behavior für den Begleiter erzeugte 3 `Vector3D`-Instanzen pro Frame in `update()`. Der Offset war fest auf die Welt-X-Achse codiert (`new Vector3D(2, 0, 0)`), anstatt relativ zur Kamera ausgerichtet zu sein.
* **Fehlende Interaktivität:** Es existierte keinerlei HUD oder Drawer, um die Behaviors live zu testen oder anzupassen.
* **Canvas Pointer-Lock:** Ein Klick auf das Canvas sperrte den Mauszeiger, was bei einer reinen Orbit-Kamera störend war und HUD-Interaktionen behinderte.

### 2. Umgesetzte Änderungen
1. **Ausrichtung korrigiert:** `body.rotation.x = -Math.PI / 2;` — die Spitze des Cones zeigt nun nach `-Z` (in Flugrichtung), die flache Basis liegt bei `+Z` direkt am Triebwerk (`z = 1.5`).
2. **StandardMaterial für Gitterboden:** `StandardMaterial` mit `diffuseMap: gridTexture`, `emissiveMap: gridTexture`, `emissiveColor: (0.6, 1.8, 3.0)` und `roughness: 0.6`. Die blauen Linien leuchten im HDR-Bloom wie zuvor, aber der Boden empfängt nun echte Schatten (`receiveShadow = true`), und das Spotlight zeichnet einen sichtbaren Lichtkegel auf den Boden.
3. **`CompanionFollowBehavior` (Zero-GC):** Eigene Klasse mit gepoolten Scratch-Vektoren (`_forward`, `_right`, `_offset`). Berechnet echten kamerarelativen Offset (vorne + rechts) ohne jegliche Allokation pro Frame.
4. **`TrailRendererBehavior` integriert:** Gepoolte leuchtende Cyan-Partikel hinter dem Triebwerk des Schiffs demonstrieren ein weiteres Built-in Behavior.
5. **`BehaviorLabHud` auf `ShowcaseDrawer`:**
   * **Kristall:** Toggles und Slider für Bobbing (Amplitude, Frequenz), Rotation (Tempo) und Rainbow (Farbwechsel-Tempo).
   * **Raumschiff:** Toggles und Slider für Umlaufzeit, Flugbahn-Pause, Look Forward, Ping-Pong-Modus, Triebwerksflackern und Ribbon-Trail.
   * **Begleiter:** Toggle für Sichtbarkeit/Aktivität, Slider für Dämpfung/Elastizität (`lerpFactor`) und Distanz zur Kamera.
   * **Suchscheinwerfer (LookAt):** Zielwahl per Button-Grid (Raumschiff, Kristall, Begleiter, Zentrum) sowie Regler für Lichtkegel und Intensität.
   * **Post-Processing:** Bloom aktivieren/deaktivieren und Intensitäts-Regler.
   * Shortcut `I` / `H` zum Ein-/Ausblenden des Panels.
6. **Mausinteraktion:** Pointer-Lock-Zwang auf Canvas entfernt. Orbit-Controller funktioniert wie gewohnt per Drag / Wheel, während der Cursor frei bleibt.
7. **Saubere State-Resets bei Deaktivierung:**
   * Bobbing aus: Kristall kehrt exakt auf Ruhehöhe `y = 3.0` zurück.
   * Rainbow aus: Kristall setzt Materialfarbe definiert auf `Color.RED` zurück.
   * Flicker aus: Triebwerk leuchtet voll und stabil mit Sollemission `(0, 2.078, 2.078)`.
   * Trail aus: Segment-Pool wird via `_trail.clear()` entleert.
8. **Unit-Tests (`apps/showcases/20/tests/BehaviorLab.test.ts`):**
   * Validiert Defaults und Geometrie-Formel des Cones (`-Math.PI / 2` rotiert Spitze nach `-Z` in Flugrichtung).
   * Validiert SpotLight-Ausrichtung per `LookAtBehavior` und Lerp-Verhalten.
