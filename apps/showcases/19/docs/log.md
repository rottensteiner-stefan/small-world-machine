# Showcase 19: Gamification & Picking — Development Log

## 2026-10-31: Picking Lab HUD & Interaktions- / Controller-Sanierung

### 1. Befund & Motivation
Showcase 19 demonstriert interaktives Ray-Picking und Gamification (`HoverBehavior`, `DraggableBehavior`, Klick-Interaktion) auf einem Würfelraster. Bei der Code- und Verhaltensüberprüfung fielen folgende Schwachstellen auf:
* **Kamera-Konflikt beim Draggen:** Der Showcase nutzte den impliziten `FlyController` (`"fly"`). Jeder Klick- und Ziehvorgang mit der linken Maustaste drehte zeitgleich die Kamera ("Mouse Look"), sodass ein kontrolliertes 3D-Ziehen von Würfeln unmöglich war.
* **Keine Unterscheidung zwischen Klick und Drag:** Im `InteractionManager` wurde beim Loslassen der Maustaste bedingungslos `onPointerClick` ausgelöst, selbst wenn der Würfel zuvor quer über den Bildschirm gezogen worden war. Jeder Verschiebevorgang änderte somit ungewollt die Farbe des Würfels.
* **Stuck Dragging bei Verlassen des Canvas:** Wurde der Zeiger mit gedrückter Maustaste aus dem Canvas bewegt und dort losgelassen, wurde `_activeObject.onPointerUp()` nie aufgerufen und `_activeObject` blieb bis zum nächsten Klick dauerhaft aktiv.
* **Starre Parameter in `HoverBehavior` und `DraggableBehavior`:** `HoverBehavior` hatte Leuchtfarbe `(0.2, 0.5, 1.0)`, Emissionsintensität `2.0` und Vergrößerung fest eincodiert. `DraggableBehavior` unterstützte ausschließlich die Kamera-Sichtebene, nicht jedoch eine horizontale Bodenebene (Tisch/XZ), und bot keinen `isDragging`-Getter oder Drag-Callbacks.
* **Fehlendes HUD:** Es existierte kein Interface, um Picking-Parameter, Drag-Modi, Rastergrößen oder Animationen auszuprobieren.

### 2. Umgesetzte Änderungen
1. **`InteractionManager`-Verbesserungen:**
   * `clickDragThreshold` (Standard 6 px): Ermittelt die Distanz zwischen MouseDown und MouseUp. Nur echte Klicks feuern `onPointerClick`.
   * Edge-Case behoben: Loslassen der Maustaste außerhalb des Canvas ruft sauber `onPointerUp()` auf und setzt `_activeObject = null`.
   * Getter `activeObject`, `hoveredObject`, `lastQueryHitsCount`, `lastIntersectCount` für HUD und Controller bereitgestellt.
2. **`DraggableBehavior`-Erweiterungen:**
   * `mode: "camera" | "ground"`: Ermöglicht freies 3D-Ziehen oder präzises horizontales Verschieben auf der Bodenebene (XZ).
   * `isDragging`-Getter sowie `onDragStart`- und `onDragEnd`-Callbacks hinzugefügt.
3. **`HoverBehavior`-Erweiterungen:**
   * Dynamisch anpassbare Eigenschaften: `hoverMultiplier`, `emissiveColor`, `emissiveIntensity`, `isHovered`.
4. **`OrbitController`-Erweiterungen:**
   * `rotateButton: "left" | "right" | "both"` und `canRotate: () => boolean`: Verhindert Kamera-Rotation während ein 3D-Objekt gezogen wird.
5. **`PickingLabHud` (auf `ShowcaseDrawer`):**
   * **Interaktion & Drag & Drop:** Toggles für Hover, Dragging und Klick-Umfärbung. Umschaltung der Drag-Ebene (Boden XZ vs. Kamera) sowie Wahl der Farbpalette (Cyber Neon, Sunset, Emerald, Rainbow, Minimal).
   * **Hover & Glow Tuning:** Schieberegler für Hover-Skalierung und Glow-Leuchtkraft, Farb-Presets (Cyan, Purple, Amber, Lime).
   * **Spielfeld & Aktionen:** Rastergrößen-Presets (10×10, 20×20, 30×30, 40×40), Abstands-Slider, "🌊 Impulswelle senden" (harmonische Sinuswelle hebt Würfel an), "🎲 Alle färben", "🔄 Reset Positionen".
   * **Kamera & Szene:** Umschaltung zwischen Orbit- und FlyCam, Schattenwurf-Toggle, HDR Bloom Post-Processing & Intensität.
   * **Live-Telemetrie:** Würfel-Anzahl, aktuell fokussierter Würfel, Dragging-Status, Raycast-Kandidaten.
   * Shortcut `I` / `H` zum Umschalten des Panels.
6. **Unit-Tests:**
   * `packages/engine/tests/core/input/InteractionManager.test.ts`: Enter/Leave, Klick vs. Drag-Threshold, Release außerhalb Canvas.
   * `packages/engine/tests/core/behaviors/DraggableBehavior.test.ts`: `isDragging`, `mode: "ground"`, Callbacks.
   * `packages/engine/tests/core/behaviors/HoverBehavior.test.ts`: Dynamische Farben, Intensitäten, Multiplikatoren.
   * `apps/showcases/19/tests/PickingLab.test.ts`: Showcase-Settings-Defaults und Paletten-Farben.

### 3. Bugfix Laufzeitfehler
* `distanceSquaredTo` -> `distanceToSq`: Laufzeitfehler in `showcase.ts:425` beim Zurückfedern der Würfel behoben.
* `enabled`-Property & Guards in `HoverBehavior` und `DraggableBehavior` ergänzt.

- 2026-11-02 review fix: `Hud.dispose()` (drawer + footer button) called from a new `destroy()` override (`super.destroy()` kept).

- 2026-11-02 i18n: Translated user-facing strings to English.
