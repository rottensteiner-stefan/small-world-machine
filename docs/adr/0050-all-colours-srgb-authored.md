# ADR 0050: Jede Engine-Farbe ist sRGB-autorisiert

- **Status:** Accepted (2026-10-26, Moderator-Entscheidung „Unity/Godot: alles sRGB“, Folge von ADR 0049)

Nach ADR 0049 waren Material-, Emissive- und Nebelfarben sRGB-Werte, Licht-, Ambient- und Clear-Farben
dagegen linear, ebenso die Tints von Volumen-Nebel, `FogVolume`, Bloom und Light-Shafts. Die gleiche
Zahl `new Color(0.5, 0.5, 0.5)` bedeutete je nach Ziel zwei verschiedene Helligkeiten. Wir folgen der
Konvention von Unity (Linear-Modus), Godot 4 und Blender-Farbwählern:

**Jede `Color`, die ein Autor oder ein Loader setzt, ist sRGB.** Die Engine wandelt sie genau einmal
nach linear: Materialfarben im Shader (`sRGBToLinear`), alles CPU-seitig Hochgeladene über
`Color.toLinear` (entspricht Unitys `Color.linear`). Gerechnet wird linear, kodiert wird einmal am Ende.

## Umsetzung

- `Color.toLinear(out)` und `Color.toTarget(gamma, out)` (`displayToTarget` auf der CPU).
- **Lichter:** `AbstractLight.linearColor` (gecacht, zero-GC). Alle Uploads lesen sie: WebGPU
  `GlobalUniformWriter`, WebGL2/WebGL1-Light-Uniforms, Volumen-Nebel-Sonne und lokale Lichter. Ambient und
  Directional schreiben sie in `aCol`/`dCol`.
- **Clear-Farbe:** `renderer.targetClearColor` = `toTarget(outputGamma)`. Ohne Post-Processing bleibt sie
  gleich, mit Post-Processing landet sie linear im HDR-Puffer. `outputGamma` ist die Lane
  (WebGL1 fest 2,2). WebGPU-Main-Pass und WebGL-Main-Pass setzen sie pro Pass.
- **Volumen-Nebel:** `VolumetricFogElement.color`, `FogVolume.albedo`/`emission` werden vor dem Upload
  dekodiert (WebGPU und WebGL2).
- **Post-Tints, die HDR skalieren:** Bloom- und Light-Shafts-Tint werden dekodiert (WebGL1-Bloom wirkt auf
  das kodierte Bild und bleibt unverändert). Outline, Flash und Grading wirken nach der Kodierung: Der
  sRGB-Wert erscheint dort unverändert.
- **`attenuationColor`** (KHR_materials_volume) wird wie jede Materialfarbe im Shader dekodiert. Das
  ersetzt die LINEAR/RAW-Festlegung vom 2026-10-24.
- **glTF:** `emissiveFactor`, `sheenColorFactor`, `attenuationColor` und `KHR_lights_punctual`-Farben sind
  in glTF linear. Der Loader kodiert sie einmal nach sRGB (wie schon `baseColorFactor`), `WorldWriter`
  dekodiert beim Export. Vorher wurden Emissive und Sheen aus glTF doppelt dekodiert.
- **Shader ohne Engine-Beleuchtung:** artistic-extras (Impasto, MetalRelief, MetalReliefScreen), der
  Shadertoy-Import und der Voxel-Block-Shader rechnen display-referenziert und geben über
  `displayToTarget` aus. Der compute.toys-Import schreibt laut compute.toys linear und kodiert mit der
  Lane. Der lineare Öl-Shader von Showcase 12 kodiert ebenfalls mit der Lane.
- Hex-Farben (`Color.fromHex`, Kit-JSON), HSL und `fromTemperature` liefern sRGB. Sie gelten unverändert.

## Migration der Konstanten

`.agents/scratches/colorspace/classify.mjs` verfolgt jede Farbkonstante in Apps und Tools mit dem
TypeScript-Checker bis zu ihrem Ziel. Konstanten, deren Bedeutung sich geändert hat, werden mit
`c^(1/2.2)` umgerechnet, sodass das Bild gleich bleibt:

- Licht, Ambient, Volumen-Nebel, Bloom- und Shafts-Tint: in allen Apps (vorher überall linear).
- Material-, Display-, Nebel- und Clear-Farben: nur in Apps mit Post-Processing (vorher dort linear).
- Paket-Defaults (liquid-/artistic-extras) bleiben: Sie wurden schon immer als sRGB dekodiert.
- Post-Processing-Status pro App aus dem Code (Showcase 40 und die the-whisper-Szenen flakturm-tunnel und
  character-diorama laufen standardmäßig ohne Post-Processing).
- HDR-Konstanten über 1 wurden durch ADR 0049 ungewollt überhöht (`3^2,2 ≈ 11`); die Migration stellt die
  ursprüngliche Intensität her. Einzige bewusste Ausnahme: das Bloom-Gitter in Showcase 20 behält den
  kräftigeren Wert, weil die korrekt dekodierte Linien-Textur sonst zu dünn wirkt.

## Abgelehnte Alternativen

- **Gemischt lassen** (Lichter linear wie Unreal-`FLinearColor`): eine dokumentierte Ausnahme pro
  Farbziel, genau die Uneinheitlichkeit, die Szenen schwer abstimmbar machte.
- **three.js-Modell** (Zahlen linear, nur Hex sRGB): hätte den Material-Decode umgedreht und alle
  Materialfarben neu interpretiert; Farbwähler und Kit-Hex-Werte wären anders als Zahlen.

## Konsequenzen

- Gleiche Zahlen bedeuten überall dieselbe Farbe. Gesättigte Lichtfarben wirken dadurch stärker gefärbt,
  für denselben Look sind die migrierten Konstanten heller notiert.
- WebGL1 sieht jetzt in Materialfarben gleich aus wie WebGPU/WebGL2 (vorher dunkler bei Szenen, die unter
  Post-Processing abgestimmt waren).
- Eigene Shader müssen Engine-Farben wie die Engine-Shader behandeln: `sRGBToLinear` am Eingang,
  Lane-Kodierung bzw. `displayToTarget` am Ausgang.

## Doctrine Compliance

- Neue öffentliche Parameter (Hot-Scope): keine Eingänge. `linearColor`, `targetClearColor` und
  `outputGamma` sind `@derived` (aus `color`, `clearColor` bzw. `postProcessing.enabled`/`quality.gamma`).
- Geteilte Abstraktion eingeführt/verbreitert? `Color.toLinear`/`toTarget`: über drei semantische
  Konsumenten (Lichter, Clear-Farbe, Volumen-Nebel/Post-Tints).
- Modeful Objekt? n/a.
- Mathematische Behauptungen: `toTarget(2,2) = id`, `toLinear = toTarget(1)`; Tests
  `packages/engine/tests/core/ColorSpaceContract.test.ts`, Quellen-Guards
  `packages/engine/tests/renderers/DecodeGammaContract.test.ts`.
- Neue Skalar-Eingänge / tier-gated Capability: n/a.
- Ausnahmen: keine.
