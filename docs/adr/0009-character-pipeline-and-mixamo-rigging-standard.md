# Charakter-Pipeline-Architektur & Mixamo-Rigging-Standard

> **Stand-Hinweis (2026-10-21):** Der Laternen-Sync (`_syncLanternTransform()`) liegt jetzt in `PlayerRig._syncLantern()` (`apps/sample-apps/the-whisper/scenes/shared/PlayerRig.ts`). Der Hand-Socket ist eine priorisierte Kandidatenliste (`LANTERN_HAND_BONE_CANDIDATES`, zuerst `LeftHandMiddle1`, `LeftHandIndex1`, dann `mixamorig:LeftHand` u. a.). Der Rig-Wrapper `_characterRig` mit fester 1,8-Skalierung ist durch `PlayerCharacterSpec.scale` pro Szene ersetzt. Die Prinzipien (Weltposition, Division durch die akkumulierte Weltskalierung) gelten weiter.

## Kontext & Problem

Aus 2D-Konzepten spielbare 3D-Charaktere für die Small World Machine zu erzeugen, braucht eine
verlässliche, mehrstufige Pipeline über 2D-Turnarounds, 3D-Mesh-Erzeugung, Skelett-Rigging,
Bewegungsclips und Engine-Einbindung hinweg.

In frühen Iterationen erwies sich automatisiertes End-to-End-Rigging über Tripo3D
(`tripo anim rig`) als grundlegend ungeeignet für den Produktiveinsatz:
1. **Bone-Explosion (>64 Bones):** Native Tripo-Rigs erzeugten 66–113 Gelenke (durch
   unkontrollierte dynamische Spring-Bones für Mantel-/Haarfalten). Small World Machines
   WebGL2-Skinning-Shader alloziert `u_boneMatrices[64]`. Gelenke mit Index $\ge 64$ deformierten
   im Shader nicht, was eingefrorene oder stark verzerrte Gliedmaßen verursachte.
2. **Inkonsistente Hierarchien & Benennung:** Selbst mit `--spec mixamo` erzeugte Tripo
   nicht-standardisierte Gelenknamen (`tripo::*`, `bone_N`) und getrennte Bone-Hierarchien
   (z. B. Gliedmaßen direkt an der Root geparentet), was geteilte Mocap-Clips brach.
3. **Getrennte Twist-Bones:** Unanimierte Twist-Bones rissen Vertex-Loops während der
   Fortbewegung auf.

## Entscheidung

Wir etablieren eine strikte Aufteilung von Zuständigkeiten, Werkzeuggrenzen und
Datei-Routing-Verträgen für alle humanoiden Charaktere:

1. **Tripo3D-Umfang (nur Geometrie):** Tripo3D ist strikt auf 3D-Mesh- und
   Texturatlas-Erzeugung beschränkt (`tripo make front.jpg --for game-mobile
   --param face_limit=15000`). Es bekommt ausschließlich eine isolierte, textfreie Frontalansicht
   (`front.jpg`) auf reinem weißem `#FFFFFF`-Hintergrund, um Mehrfach-Charakter-Halluzinationen
   zu vermeiden. Es wird **nie** für Skelett-Rigging verwendet.
2. **Adobe-Mixamo-Standard (exklusives Rigging & Auto-Packaging):** Adobe Mixamo ist der
   **exklusive kanonische Rigging-Standard** für alle spielbaren humanoiden Figuren.
   - *Automatisiertes Packaging:* Um Mixamos *"unable to map your existing skeleton"*-Fehler zu
     vermeiden (verursacht durch FBX-Exporter-Root-Node-Metadaten), konvertiert die Pipeline
     `base_model.glb` automatisch in ein sauberes, statisches Wavefront-OBJ (`model.obj` +
     `model.mtl` + `texture.jpg`), gebündelt in `<character>_mixamo.zip`.
   - *Rig-Einlesen:* Das Hochladen von `<character>_mixamo.zip` garantiert sauberen
     Mesh-Import und löst Mixamos 5-Punkt-Auto-Rigger zuverlässig aus.
   - *Gelenk-Limits:* Saubere 52-Gelenk- (ohne Finger) oder 65-Gelenk- (Standard)
     Biped-Hierarchie (`mixamorig:*`), passend innerhalb der GPU-Shader-Limits ($\le 64$ Gelenke
     für 52-Gelenk-Rigs).
3. **Striktes Datei-Routing & Übergabevertrag:**
   - **2D-Konzepte:** `apps/<app>/docs/assets/<character>/` & `raw/.../model_sheet.jpg`
     (Turnaround) + `raw/.../front.jpg` (Albedo-Frontal-Input).
   - **DCC-/Raw-Staging:** `apps/<app>/raw/mannequin/<character>/base_model.glb`,
     `<char>_mixamo.zip`, und `character_rigged.fbx`.
   - **Laufzeit-Modelle:** `public/assets/<app>/mannequin/<character>/character.glb`
     (eigenständiges binäres glTF mit 2K-Texturatlas).
   - **Geteilter Mocap-Pool:** `public/assets/<app>/mannequin/shared/anim/*.glb` (alle Clips vor
     Ort).
4. **Engine-Einbindungsmuster:**
   - **Rig-Wrapper:** Die Charakter-Root wird auf Standard-Menschgröße skaliert (1,80 m über
     `.scale.set(1.8, 1.8, 1.8)`) und in ein übergeordnetes `_characterRig` (`Object3D`)
     gewrappt. Bewegungs-Behaviors (`StageMovementBehavior`) hängen an `_characterRig` an,
     damit Perspektiv-Skalierung nicht die lokale Modellhöhe überschreibt.
   - **Semantische Hand-Sockets:** Standardisierte Anbindung an `mixamorig:LeftHand`
     (Laterne: lokaler Versatz `(0.01, 0.06, 0.02)` und Rotation `0`). **Update:** dieser konkrete
     Anbindungs-Mechanismus (direktes Scene-Graph-Kind der Hand-Bone) wurde seither durch reines
     Weltraum-Positions-Tracking ersetzt (`_syncLanternTransform()` in `flakturm-tunnel`s und
     `character-diorama`s `showcase.ts`) -- kein Scene-Graph-Kind mehr, Rotation wird nie
     übernommen (die Laterne hängt dadurch immer gerade herab statt mit der Handbewegung
     mitzutaumeln), und der lokale Versatz ist jetzt dynamisch je nach Bone-Typ
     (Finger- vs. Handgelenk-Bone) und durch die akkumulierte Bone-Weltskalierung geteilt (behebt
     einen ~100x-cm-zu-m-Skalierungsartefakt, das Mixamo-Rigs oft in ihre Bones backen). Das
     semantische Hand-Socket selbst (`mixamorig:LeftHand`, mit Fallback-Kandidaten für
     Finger-Bones und Nicht-Mixamo-Rigs) ist weiterhin der Referenzpunkt -- nur *wie* die Laterne
     daran hängt, hat sich geändert.
5. **Kanonische Charakter-Ausrüstung & Zwei-Gürtel-Architektur:**
   - **Laterne in der linken Hand:** Die Laterne wird ausschließlich in der linken Hand getragen
     (`mixamorig:LeftHand`), sodass die rechte Hand frei bleibt.
   - **Zwei-Gürtel-System:**
     - *Gürtel 1 (Hose & Nütz­gürtel):* Trägt Hose, Nutztaschen und die Gasmaske.
     - *Gürtel 2 (Holster-Gürtel):* Trägt ein kleinkalibriges Pistolenholster, positioniert
       **vorne links** (Cross-Draw-Zugriff).
   - **Doppelfilter-Gasmaske:** Vollgesichts-Atemschutzmaske mit zwei Wangenfiltern. Wird im
     Erkundungsmodus (Zustand 1: BASE) **vorne rechts** an Gürtel 1 getragen, oder gesichtsbedeckend
     ausgerüstet (Zustand 2: HAZARD).

## Konsequenzen

- **Manueller Schritt:** Rigging erfordert einen einmaligen manuellen
  Upload-/Marker-Platzierungs-Schritt in der Adobe-Mixamo-Web-UI durch den Entwickler.
- **Zuverlässigkeit:** Eliminiert Vertex-Risse, eingefrorene Meshes, Shader-Uniform-Overflows und
  individuelles GLB-Binär-Patching.
- **Austauschbarkeit:** Alle Charaktere teilen sich denselben Animations-Pool und dieselben
  Requisiten-Sockets, ohne individuelles Re-Targeting oder Code-Verzweigungen.
