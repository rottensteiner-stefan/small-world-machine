# Showcase 45 — Fire VFX Lab · Living Log

## Zweck

Labor- und Abnahme-Szene für den Feuer-Plan (`.agents/scratches/fire-plan.md` v2, lokal). Wächst
phasenweise mit: P1 Flammenkörper + Glow, P2 Licht/Flackern, P3/P4 Funken, Rauch, `Fire`-Komposition,
P6 Goldens. Nachtszene vor einer Steinwand, damit Emission, Bloom und Lichtwurf ablesbar sind.

## Inhalt

- Drei Wandfackeln: Blackbody (2000 K), `FlamePalettes.SPECTRAL` (Gespensterblau), `FlamePalettes.WISP` (Irrlichtgrün).
- Kleines Lagerfeuer (3 Cards, 0,5 × 0,8 m, 5 Scheite) und eine Kerze.
- Je Flamme: `FireMaterial` auf `createFlameCardGeometry`, `FlameGlowMaterial` auf einem Billboard-`Plane`, ein `PointLight`.
- Renderer-Wechsel: Alt+1 WebGL1, Alt+2 WebGL2, Alt+3 WebGPU.

## 2026-10-29 · P1: Flammenkörper + Glow

- `packages/vfx-extras/src/fire/`: `FireMaterial` (GLSL300/GLSL100/WGSL), `FlameGlowMaterial`, `createFlameCardGeometry`.
- Gate bestanden: Extras-Pakete registrieren eigene Shader über `getShaderDefinition()` (Präzedenz
  `liquid-extras`); `BlendingMode.ADDITIVE` über `state.blending` wird von WebGL- und WebGPU-Pfad
  bereits ausgewertet, keine Engine-Änderung nötig.
- Flamme: zwei aufwärts scrollende Value-Noise-fBm-Lagen (A verzerrt B), Tropfenmaske, höhenabhängige
  Erosion (Basis geschlossen, Spitze reißt in Zungen), 3-Stopp-Ramp. Edge-Fade nach Blickwinkel
  versteckt seitlich gesehene Cards. Lean über `lean` (Welt-Vektor) entlang `cross(up, n)`.
- Farbe: Standard ist Blackbody aus `temperatureK` (Kern ×1,4, Spitze ×0,65). Optional `palette`
  übersteuert (Nutzerwunsch: gespenstisch blau/grün). Glow analog per `tint`.
- Erste Iteration war ein dünner, überstrahlter Strich; Form verbreitert (halfWidth 0,46),
  Erosion verstärkt, Kanten härter, Standard-Intensität 4 → 2,5.
- Browser-Check alle drei Tiers ohne Konsolenfehler. Beobachtung (nicht Feuer): Die
  Standard-Beleuchtung ist auf WebGL1 deutlich heller als auf WebGL2/WebGPU.
- Abweichung vom Plan: Noise lebt lokal in den Fire-Shadern statt als Engine-Chunk `noise_fbm` —
  aktuell nur ein Konsument, die Rule of Three (ADR 0047) rechtfertigt den geteilten Chunk noch nicht.
- Bekannte Lücken: kein Nebel-Einfluss auf additive Flammen; Licht flackert noch über
  `FlickerBehavior` (Phasenmodell) bis `FireLightBehavior` (P2) kommt.
