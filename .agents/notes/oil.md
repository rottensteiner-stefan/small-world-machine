# Öl-/Irideszenz-Referenzen (rekonstruiert)

> **Status:** REKONSTRUIERT am 2026-10-10. Referenznotiz, die in `OilSlick.frag.*` (the-whisper, character-diorama) als „oil.md’s Godot reference“ zitiert wird. Inhalte aus der Recherche des Kollaborationsplans `oil-puddles.md` (verifizierte Web-Quellen) rekonstruiert.

## Godot — Stand & bewährte Techniken `[SOURCED: docs.godotengine.org, godotshaders.com, 2026-10]`

- **Kein** Built-in für Irideszenz/Thin-Film: `StandardMaterial3D`/`BaseMaterial3D` hat keinen Parameter; `KHR_materials_iridescence` wird weder im Material noch im glTF-Importer unterstützt (0 Treffer).
- Community-Ersatz = derselbe **`N·V`-getriebene Hue-Trick**, den Small World Machine bereits nutzt: `hue = fract(dot(NORMAL, VIEW)·k)` → HSV→RGB, Grazing-Gating via `pow(1−dot(N,V), n)`, Fresnel-Mix von Reflexion gegen Albedo (Schlick `0.02 + 0.98·(1−N·V)⁵`).
- **Wirklich entscheidend für gute Pfützen ist Reflexions-Plumbing**, nicht die Farbe: opake Pfützen-Wipe (nur up-facing Normale), `roughness→0`/`metallic`-Wipe via Maske + eigene SSR-Ray-March (z.B. „Rain Puddles V3“, marcelb/GodotSSRWater) oder Planar-Spiegelkamera (`SubViewport`).
- **Web-Härte:** Godot im Browser hat keinen SSR (Forward+ exklusiv, Web = Compatibility); Reflexion muss über IBL/Planar/Fake laufen → Direktübertrag auf Small World Machine (dort: `PlanarReflectionNode`, envMap).
- Usuelle Fehlerfalle (auch Small World Machine): transparente nasse Overlays schreiben keinen Tiefenpuffer → von SSR unsichtbar; Pfützen daher opak rendern oder als Vollbild-Pass.

## Unity (Medium: Tay Hao Cheng, „Creating a Puddles Shader in Unity“, 2024-03) `[SOURCED]`

- Artikel behandelt **nass/spiegelnd**, nicht Regenbogen-Öl: Höhenmap+Perlin-Pfützenmaske, flache Normalen (0.5,0.5,1), Smoothness=1/Metallic=1, Ripple-Noise über Zeit.
- Referenzbild „ultimative Pfütze“ (Medium-Asset): dunkle nasse Nachtszene, gesättigte Cyan+Rot-Anteile v.a. untere Bildhälfte (Pfütze spiegelt Farblicht) — Zielbild ist Reflexions-/Kompositionsqualität, nicht bunte Palette.

## Realtime-Industrie (Filament / KHR) `[SOURCED: lokale Kopie .agents/scratches/filament-materials.html, KHR-Repo]`

- Dünnschichtparameter: `iridescenceIor` (Default 1.3), `iridescenceThickness` (nm), Schicht unter Clear-Coat.
- Small-World-Machine-Implementierung (`thinFilm` in OilSlick.frag.*) folgt diesem Prinzip als Zwei-Strahl-Approximation (Fresnel R1/R2, Snell, OPD, Wellenlängenphasen), nicht die Belcour-Barla-Spektralsumme; Desaturation durch `strength` (Stilregler, „muted“).

## Blender (Stil-Randnotiz) `[SOURCED: Cartesian Caramel „How to make Oil Spill Materials in Blender!“ (xcx_LfXuuX4); Node-Based „OIL SHADER in Blender 4.2“ (0o4BGLjIDyk)]`

- Öl-Irideszenz gängig via Glossy-BSDF + Fresnel-/Hue-getriebener Farbe + Noise-Normalen — für Small World Machine eher Konzept-Referenz als direkte Technik-Übernahme.
