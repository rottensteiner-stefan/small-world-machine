# ADR 0027: Erweiterung des `ObjectUniforms`-Puffers auf 512 Byte & Entflechtung der Semantik-Slots

> **Stand-Hinweis (2026-10-21):** Die Dual-Write-Übergangsphase (Entscheidung 3) ist beendet: `LiquidWaveMaterial` schreibt nur noch `u_matParam0..6`, die Shader lesen `u_matParam*`. Die Testzahlen im Text sind ein historischer Stand. ADR 0039 hat das Muster um `MaterialLanes` erweitert.

> Status: ACCEPTED (Oktober 2026, Gesamtpaket zur Überwindung des 256-Byte-Flaschenhalses)
> Replaces / Supersedes: [ADR 0026](./0026-object-uniforms-256-byte-moat.md)

## Kontext & Problem

In ADR 0026 wurde der `ObjectUniforms`-Block (`StandardWebGPULayout.ts` und `structs.wgsl`) auf **256 Byte** (64 Floats = 16 `vec4`) festgeschrieben. Grund war die historische Annahme, dass WebGL1 (GLSL ES 1.00) im Fragment-Stage eine Untergrenze von 16 `vec4` Uniforms garantiert und jedes Byte darüber WebGL1 brechen könnte.

Diese 256-Byte-Kappe führte in der Praxis zu starkem semantischem „Slot-Hijacking“:
- `u_isSkinned`, `u_boneOffset`, `u_pad1` wurden für `waterAbsorption.rgb` zweckentfremdet.
- `u_shininess` wurde als `refractionStrength` missbraucht.
- `u_isTerrain`, `u_metallic`, `u_roughness` wurden als `foamColor.rgb` genutzt.
- `u_useEnvMap`, `u_useReflectionMap`, `u_pad2`, `u_pad3` trugen Schaumparameter (`foamCutoff`, `foamNoiseScale`, `foamNoiseSpeed`, `foamDistance`).
- `u_texOffset` und `u_texRepeat` wurden für `edgeColor.rgb` und `edgeSoftness` gekapert.

### Technische Neubewertung: Warum die 256-Byte-MOAT ein Trugschluss war

1. **WebGL1 nutzt gar keine UBOs (`UniformBufferObject`):** In WebGL1 werden Uniforms einzeln via `gl.uniform4fv` bzw. `gl.uniform1f` gesetzt. Es existiert kein geteilter 256-Byte-Ringbuffer.
2. **WebGL1-Uniform-Limit zählt nur aktiv referenzierte Variablen:** Das GLSL-ES-1.00-Limit von minimal 16 `vec4` Uniforms gilt pro Fragment-Programm und umfasst durch Dead-Code-Elimination des GPU-Treibers nur jene Uniforms, die in dem jeweiligen Shader tatsächlich vorkommen. Ein Shader deklariert nur die Uniforms, die er benötigt.
3. **WebGPU und WebGL2:** Moderne Standards unterstützen 16 KB bis 64 KB pro Uniform-Block. Ein Anheben der Layout-Struktur auf 512 Byte (128 Floats = 32 `vec4`) liegt um Größenordnungen unter den Hardware-Limits von WebGPU (`maxUniformBufferBindingSize` >= 64 KB) und WebGL2 (`MAX_UNIFORM_BLOCK_SIZE` >= 16 KB).

## Entscheidung

1. **Erweiterung von `ObjectUniforms` auf 512 Byte (128 Floats = 32 `vec4`):**
   - `StandardWebGPULayout.ts`: Erweitert um `u_matParam0` bis `u_matParam15` (je `vec4`).
   - `structs.wgsl`: `struct ObjectUniforms` ergänzt um `matParam0` bis `matParam15: vec4f`.
   - `WebGPURenderer.ts`: `_scratchObjBufferData` von 64 auf 128 Floats (512 Byte) vergrößert.
   - `GPUObjectRingBuffer.ts`: Alignment und Stride auf 512 Byte (`Math.ceil(512 / alignment) * alignment`) angepasst.
2. **Entflechtung & saubere Semantik-Slots:**
   - Neue oder modernisierte Shader lesen materialbezogene Parameter strukturiert aus `matParam0..15` bzw. deren semantischen Aliassen.
   - Für `OpenWater`:
     - `matParam0`: `vec4(waterAbsorption.rgb, refractionStrength)`
     - `matParam1`: `vec4(foamColor.rgb, foamDistance)`
     - `matParam2`: `vec4(foamCutoff, foamNoiseScale, foamNoiseSpeed, foamIntensity)` (Stand 2026-10-21: bei `OpenWaterMaterial` trägt `matParam2.w` stattdessen `poolHalfExtent`; ein `foamIntensity` gibt es nicht)
3. **Abwärtskompatibilität (Dual-Write):**
   - Bestehende Materialien (`LiquidWaveMaterial`) belegen zur Wahrung voller Rückwärtskompatibilität vorerst sowohl die Legacy-Slots als auch die neuen `matParam`-Slots.
   - WebGL1-Shader (`glsl100`) behalten ihre schlanken, selektiven Einzeluniform-Deklarationen und bleiben damit 100% konform zur GLSL-ES-1.00-Spezifikation.

## Konsequenzen

+ **Kein Slot-Mangel mehr:** 16 neue `vec4`-Slots (64 zusätzliche Floats) bieten ausreichend Raum für realistische Ozean-/Flüssigkeitseffekte (Mehrwellen-Gerstner, Anisotropie, Partikel, Tiefenfarben).
+ **Saubere Shader-Lesbarkeit:** Kein verwirrendes Hacken von `u_isSkinned` oder `u_boneOffset` in Wasser- oder Spezialmaterialien.
+ **Volle WebGL1-, WebGL2- und WebGPU-Kompatibilität:** Alle 246 Testsuiten / 1505 Unit-Tests laufen fehlerfrei durch. WebGPU- und WGSL-Linter validieren die Byte-Ausrichtung perfekt.
