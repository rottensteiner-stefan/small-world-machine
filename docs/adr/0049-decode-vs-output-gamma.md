# ADR 0049: Dekodier-Gamma ist fest, nur die Ausgabe folgt der Gamma-Lane

- **Status:** Accepted (2026-10-25, Moderator-Entscheidung „erst IBL, dann PP-Fix“, Folge von ADR 0048)

Die globale Gamma-Lane (`global.gamma` / `u_gamma`) hatte zwei Aufgaben: Sie kodiert die Ausgabe des
Forward-Pass (`linearToSRGB`) und sie dekodierte jede 8-Bit-Eingabe (`sRGBToLinear`). Mit aktivem
Post-Processing schreiben beide Renderer `gamma = 1.0`, weil der Post-Pass tonemappt und kodiert. Damit
war auch die Dekodierung Identität: Albedo, Materialfarben, Emissive, IBL und Skybox kamen als sRGB-Werte
in die lineare Beleuchtung, und der Post-Pass kodierte sie ein zweites Mal. Ergebnis: ausgewaschene,
zu helle, entsättigte Bilder in allen Showcases mit Post-Processing.

Wir trennen die beiden Rollen:

- **`sRGBToLinear` dekodiert Assets fest mit 2,2** (Texturen, Materialfarben, IBL-Würfel, Asset-Cubemaps,
  Farb-Rampen), unabhängig von Post-Processing und `quality.gamma`. Gegenstück zum Kodier-Vertrag
  `c^(1/2.2)` aus ADR 0048.
- **`targetToLinear` dekodiert Engine-Render-Targets mit der Lane.** Opaque-Capture, Planar-Reflection
  und dynamische Reflexions-Probes hat der Forward-Pass selbst mit `linearToSRGB` (Lane) geschrieben:
  ohne Post-Processing sRGB-kodiert, mit Post-Processing linear. Die Dekodierung muss derselben Lane
  folgen.
- **`u_useEnvMap`** unterscheidet beide Fälle für `u_envMap`: `0` = keiner, `1` = Asset-Cube (sRGB),
  `2` = `RenderTargetCube` (Probe, Lane). `StandardMaterial` setzt den Wert aus dem Typ.
- **Display-Shader** (Skybox, Basic, Sprite, Wireframe, RetroScreen) gaben ihre Farbe bisher roh aus.
  Sie dekodieren jetzt mit 2,2 und kodieren über die Lane. Ohne Post-Processing ist das exakt die
  alte Ausgabe, mit Post-Processing landen sie linear im HDR-Puffer.
- Die Lane bleibt das Signal „Post-Processing aktiv“ (`gamma == 1.0`, Reinhard-Guard).
- Der Nebel-Ambient (`froxel_inject.wgsl`, `VolumetricFog.frag.glsl`) dekodiert die IBL-Irradiance jetzt
  ebenfalls (offene Lücke aus ADR 0048). Showcase 37 ist auf sRGB-kodierte IBL-Dateien umgerechnet.

## Abgelehnte Alternativen

- **Lane bei Post-Processing auf 2,2 lassen und den Post-Pass nicht kodieren:** würde Bloom, HBAO und
  Tonemapping auf kodierte Werte setzen. Die Post-Kette braucht lineares HDR.
- **Zweite Lane `decodeGamma` im globalen Uniform-Block:** zusätzlicher Parameter ohne Freiheitsgrad.
  Asset-Kodierung ist durch die Dateien festgelegt, nicht durch eine Display-Einstellung.
- **Neues Shader-Flag für Probe-Cubes:** neue Programmvarianten für einen Fall, den die vorhandene Lane
  `useEnvMap` abdeckt.

## Konsequenzen

- Alle Showcases mit Post-Processing werden dunkler und satter (korrekter linearer Workflow). Szenen,
  die unter dem Doppel-Kodieren abgestimmt wurden, brauchen eventuell Licht- oder Belichtungs-Nachjustage.
- Material- und Nebelfarben sind sRGB-Autorenwerte; Licht-, Ambient- und Clear-Farben bleiben linear.
  Unter dem alten Identitäts-Decode geschriebene Material-/Nebel-Konstanten waren faktisch linear: Für
  denselben Look werden sie mit `c^(1/2.2)` umgerechnet (so geschehen in Showcase 12, 30, 32, 37;
  in 30 zusätzlich Lack und Key-Licht des Autos, das jetzt einen korrekt dunklen Nachthimmel spiegelt).
- Ohne Post-Processing ändert sich nichts, solange `quality.gamma` 2,2 ist.
- WebGL1 dekodiert und kodiert schon fest mit 2,2 und sein Post-Pass kodiert nicht: unverändert.
- Eigene Shader, die Farben ohne `sRGBToLinear` roh ausgeben, sind mit Post-Processing weiter
  display-referenziert; sie sollten `sRGBToLinear` am Eingang und `linearToSRGB` am Ausgang nutzen.

## Doctrine Compliance

- Neue öffentliche Parameter (Hot-Scope): keine. `u_useEnvMap` bekommt den Wert `2`
  (`@derived` aus dem Typ von `StandardMaterial.envMap`).
- Geteilte Abstraktion eingeführt/verbreitert? `targetToLinear` im bestehenden Farbraum-Chunk
  (`pbr_math.wgsl`, `lights.frag.glsl`), ADR-0038-Renderer-Infrastruktur.
- Modeful Objekt? n/a (Post-Processing an/aus wechselte die Lane schon vorher pro Frame).
- Mathematische Behauptungen: `pow(pow(c, 2.2), 1/2.2) = c` für die Display-Shader ohne
  Post-Processing; Quellen-Guard `packages/engine/tests/renderers/DecodeGammaContract.test.ts`.
- Neue Skalar-Eingänge / tier-gated Capability: n/a.
- Ausnahmen: keine.
