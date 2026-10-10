---
name: character-pipeline
description: End-to-end workflow from 2D concept sketch to game-ready, rigged 3D character in Small World Machine.
---

# 2D to 3D Character Pipeline — Das vollständige Rezeptbuch

Dieses Dokument definiert den verbindlichen, praxiserprobten End-to-End-Workflow zur Erstellung spielbarer, geriggter und sauber animierter 3D-Charaktere für die **Small World Machine**.

---

## 🗺️ Pipeline-Architektur im Überblick

```text
[ 1. 2D-Konzept & Albedo-Vorlagen ]
  - 🤖 AUTOMATISCH: Gemini API / generate_image
  - `model_sheet.jpg`: 3-in-1 Turnaround (16:9) für Dossier & Art-Direction
  - `front.jpg`: Isolierte, textfreie Frontalansicht (45° A-Pose) auf #FFFFFF für Tripo3D
                        │
                        ▼
[ 2. 3D-Geometrie & Texturatlas (Tripo3D) ]
  - 🤖 AUTOMATISCH: `tripo make front.jpg --for game-mobile --param face_limit=15000`
  - 10k–25k Triangles, 2K Textur-Budget (NO 4K/8K) ➔ `base_model.glb`
                        │
                        ▼
[ 2.5. Automatisches Mixamo-Packaging (Agent) ]
  - 🤖 AUTOMATISCH: Konvertierung `base_model.glb` ➔ Clean Static Wavefront OBJ (`model.obj` + `model.mtl` + `texture.jpg`)
  - Erzeugt `<character>_mixamo.zip` (verhindert Mixamo-Fehler „unable to map your existing skeleton“)
                        │
                        ▼
[ 3. Skeletal Rigging & Skinning (Adobe Mixamo Standard) ]
  - 👤 MANUELL: User lädt `<character>_mixamo.zip` in [Mixamo Web](https://mixamo.com) (52/65-Joint Biped Rig)
  - 🤖 AUTOMATISCH: Konvertierung nach GLB (`character.glb`) & Bone-Validierung
                        │
                        ▼
[ 4. In-Place Motion Library & Prop-Stabilisierung ]
  - 🤖 AUTOMATISCH / 👤 MANUELL: In-Place Clips (`idle_torch`, `walk_torch`, `ascending_stairs`)
  - Fixierte Handhaltung für getragene Ausrüstung (Laterne, Waffe)
                        │
                        ▼
[ 5. Small World Machine Runtime-Integration ]
  - 🤖 AUTOMATISCH: Multiplikativer `_characterRig` Wrapper (1.80m Skalierungsschutz)
  - PBR-Sanitizing (`clampMetallic`) / Graphic-Noir `BasicMaterial`
  - Semantischer Hand-Socket (Laterne: (0.01, 0.09, 0.02), Z = π/2)
  - AnimationMixer mit Cross-Fading
```

---

## 📋 File Handover & Workflow Contract (Wer liefert was wohin?)

Dieser Vertrag definiert für jeden Schritt exakt:
1. **Modus:** `🤖 AUTOMATISCH` (Agent/CLI) vs. `👤 MANUELL` (User/Web-UI)
2. **Input:** Woher die Eingabedatei stammt
3. **Output:** Wo die erzeugte Datei abgelegt werden **MUSS**

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ÜBERSICHT ALLER PFADE & ORDNER                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. 2D-Konzepte & Dossier:    src/apps/<app>/docs/assets/<character>/                            │
│ 2. DCC- & Authoring-Daten:   src/apps/<app>/raw/mannequin/<character>/                          │
│ 3. Shared Raw Mocap (.fbx):  src/apps/<app>/raw/mannequin/shared/                              │
│ 4. Runtime-Charakter (.glb): public/assets/<app>/mannequin/<character>/character.glb           │
│ 5. Runtime-Mocap (.glb):     public/assets/<app>/mannequin/shared/anim/*.glb                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Stufen-Matrix:

| Stufe | Modus | Input-Pfad (Erwartet) | Output-Pfad (Erzeugt) | Ausführendes Tool / Aktion |
| :--- | :---: | :--- | :--- | :--- |
| **1. 2D-Vorlagen** | `🤖` / `👤` | `src/apps/<app>/docs/assets/<char>/hoodie.jpg` | `src/apps/<app>/raw/mannequin/<char>/model_sheet.jpg`<br>`src/apps/<app>/raw/mannequin/<char>/front.jpg` | Gemini API / `generate_image` + `sips` Crop |
| **2. 3D-Mesh & Atlas** | `🤖` | `src/apps/<app>/raw/mannequin/<char>/front.jpg` | `src/apps/<app>/raw/mannequin/<char>/base_model.glb` | `tripo make front.jpg --for game-mobile` |
| **2.5. Mixamo-Paket** | `🤖` | `src/apps/<app>/raw/mannequin/<char>/base_model.glb` | `src/apps/<app>/raw/mannequin/<char>/<char>_mixamo.zip` | Automatischer Node-Export (`model.obj` + `texture.jpg` ➔ `.zip`) |
| **3. Mixamo Rigging** | `👤` *(User)* | `src/apps/<app>/raw/mannequin/<char>/<char>_mixamo.zip` | `src/apps/<app>/raw/mannequin/<char>/character_rigged.fbx` | User zieht `.zip` in [Mixamo Web](https://mixamo.com), setzt 5 Marker & lädt T-Pose `.fbx` |
| **3.5. GLB-Export** | `🤖` *(Agent)*| `src/apps/<app>/raw/mannequin/<char>/character_rigged.fbx` | `public/assets/<app>/mannequin/<char>/character.glb` | Konvertierung FBX ➔ GLB (gltf-transform / FBX2glTF) |
| **4. Shared Mocap** | `🤖` / `👤` | `src/apps/<app>/raw/mannequin/shared/*.fbx` | `public/assets/<app>/mannequin/shared/anim/*.glb` | In-Place Studio-Clips (`idle_torch`, `walk_torch`, `ascending_stairs`) |
| **5. Engine-Ingest** | `🤖` *(Agent)*| `public/assets/<app>/mannequin/<char>/character.glb`<br>`public/assets/<app>/mannequin/shared/anim/*.glb` | `src/apps/<app>/scenes/<scene>/` | `GltfLoader` + `_characterRig` Wrapper + Sockets + `AnimationMixer` |

---

## 🍳 Rezept 1: 2D-Konzept ➔ Model-Sheet & Front-View

> **Wichtigste Erkenntnis:** Tripo3D's Einzelbild-KI (`tripo make`) benötigt für die 3D-Rekonstruktion zwingend ein **isoliertes Frontal-Bild (`front.jpg`)**. Ein 3-Ansichten-Sheet im selben Bild führt dazu, dass Tripo mehrere Figuren generiert oder das Mesh verzerrt.
> - `model_sheet.jpg` (16:9, 3 Ansichten): Dient als visuelles Dokumentations- und Turnaround-Asset im Dossier.
> - `front.jpg` (Isolierte Frontalfigur): Dient als präziser Eingabevektor für Tripo3D.

### 1. Das Albedo-First-Mandat (Unabdingbare 3D-Regel)
* **Keine Richtungsschatten oder Lichtkegel:** Schatten und Glanzlichter werden zur Laufzeit von Small World Machine in Echtzeit berechnet (`PointLight`, `DirectionalLight`, `OutlineElement`).
* **Pflicht-Keywords für alle Turnaround-Prompts:**
  > *„Pure unshaded flat Albedo diffuse reference, neutral diffuse color map, perfectly even flat ambient studio lighting, ZERO cast shadows, ZERO highlights, solid pure white background (#FFFFFF).“*

### 2. Posen- & Ausrüstungs-Geometrie

#### Posen-Geometrie:
* **Front & Back:** Symmetrische **A-Pose (45°)** (empfohlen) oder **T-Pose (90°)**. Beide Hände leer. Füße zeigen exakt parallel nach vorne (0° Auswärtsdrehung).
* **Right Profile (90° nach rechts gewandt):** **Arme hängen entspannt am Körper herab** (Arme in T-Pose würden das Profil verdecken).

#### 🧰 Das verbindliche Ausrüstungs- & Gürtel-System:
1. **Linke Hand (Laterne):**
   * Die Laterne wird **immer in der linken Hand** getragen (`mixamorig:LeftHand`). Die rechte Hand bleibt frei.
2. **Zwei-Gürtel-System:**
   * **Gürtel 1 (Hosen- & Utility-Gürtel):** Hält die Hose, Taschen und Ausrüstung.
   * **Gürtel 2 (Waffengürtel):** Trägt den Holster für eine kleinkalibrige Pistole.
   * **Holster-Position:** Immer **vorne links** am Gürtel befestigt (Cross-Draw-Zugriff).
3. **Vollgesichtsschutzmaske (Dual-Filter Respirator):**
   * Vollmaske mit zwei markanten Filterdosen (links und rechts an den Wangen).
   * **Trageposition am Gürtel:** Hängt immer **vorne rechts** am Ausrüstungsgürtel.
   * **Zustände:**
     - *State 1 (BASE / Standard):* Maske hängt vorne rechts am Gürtel, Gesicht & Haare frei sichtbar, Kapuze liegt flach auf den Schultern oder über dem Kopf.
     - *State 2 (TOXIC HAZARD / Aufgesetzt):* Maske umschließt das Gesicht, Filter links/rechts, Kapuze über den Kopf gezogen.

### 3. Extraktion der isolierten Frontansicht (`front.jpg`)
Aus dem erzeugten Model-Sheet wird die Frontansicht ohne Textüberschriften sauber via `sips` freigestellt:
```bash
sips -c 670 460 --cropOffset 45 10 src/apps/<app>/raw/mannequin/<char>/model_sheet.jpg --out src/apps/<app>/raw/mannequin/<char>/front.jpg
```

---

## 🍳 Rezept 2: 3D-Mesh-Generierung & Mixamo-Packaging

Tripo3D wird **ausschließlich für die 3D-Geometrie und den Texturatlas** eingesetzt — niemals für Auto-Rigging.

### 1. Ausführung via `tripo-cli` (aus `front.jpg`)
```bash
tripo make src/apps/<app>/raw/mannequin/<char>/front.jpg --for game-mobile --param face_limit=15000 -o src/apps/<app>/raw/mannequin/<char>/tripo-out --json --yes
```

### 2. Automatisches Mixamo-Packaging (`base_model.glb` ➔ `.zip`)
> **🚨 WARUM DIESER SCHRITT NÖTIG IST:**
> 1. **Skelett-Fehlinterpretation:** Tripo's FBX-Konverter exportiert Root-Knoten, die Mixamo als fehlerhaftes Skelett fehlinterpretiert (*„unable to map your existing skeleton“*). GLB wird von Mixamo Web nicht unterstützt.
> 2. **Boden-Ausrichtung (Ground-Plane $Y=0$):** Tripo zentriert Modelle um den Ursprung $(0,0,0)$ ($Y \in [-0.5, +0.5]$), wodurch die Hüfte bei $Y=0$ liegt und die Beine unter dem Mixamo-Boden versinken.
>
> **Der automatische Konvertierungs-Standard:**
> - Konvertiert `base_model.glb` in ein sauberes **Wavefront OBJ** (`model.obj` + `model.mtl` + `texture.jpg`).
> - **Ground-Plane Normalisierung:** Verschiebt alle Vertices so, dass die Fußsohlen exakt auf $Y = 0.00$ aufsitzen ($y' = y - minY$) und skaliert die Figur auf $1.80\text{m}$.
> - Bündelt alles in `<char>_mixamo.zip`. Dadurch steht der Charakter aufrecht auf dem Mixamo-Boden und der 5-Punkte-Auto-Rigger funktioniert perfekt.

---

## 🍳 Rezept 3: Skeletal Rigging & Skinning (Adobe Mixamo Standard)

> **Architektur-Entscheidung:** Für alle spielbaren Charaktere in Small World Machine ist **Adobe Mixamo der einzige verbindliche Rigging-Standard**. Tripo Auto-Rigging wird nicht verwendet, da es zu Knochen-Explosionen (>64 Bones), nicht-standardisierten Benennungen und zerreißenden Gliedmaßen führt.

### 1. Manueller User-Schritt (Mixamo Web-UI)
1. Die generierte Zip-Datei [`src/apps/<app>/raw/mannequin/<char>/<char>_mixamo.zip`](src/apps/and-now/raw/mannequin/) in [Adobe Mixamo](https://www.mixamo.com/) hochladen (Drag & Drop).
2. **Auto-Rigger Marker platzieren:**
   - `Chin` (Kinn)
   - `Wrists` (Handgelenke)
   - `Elbows` (Ellbogen)
   - `Knees` (Knie)
   - `Groin` (Schritt)
3. **Skeleton LOD:** Standard `Standard Skeleton (65 Bones)` oder `No Fingers (52 Bones)` wählen. Beide liegen sicher unter dem 64- bzw. Shader-Limit und besitzen saubere Edge-Loop-Gewichtungen.
4. Nach erfolgreichem Rigging als **FBX (.fbx) mit T-Pose** herunterladen.
5. Datei ablegen unter:
   `src/apps/<app>/raw/mannequin/<char>/character_rigged.fbx`

### 2. Automatischer Agent-Schritt (GLB-Konvertierung, Skalierung & Validierung)
Sobald die geriggte `.fbx` in `raw/` liegt, konvertiert der Agent das Modell nach `.glb` und deployt es ins Runtime-Verzeichnis:
```bash
# 1. Konvertierung via fbx2gltf
fbx2gltf -b -i src/apps/<app>/raw/mannequin/<char>/character_rigged.fbx -o public/assets/<app>/mannequin/<char>/character
```
**Post-Processing & Validierung:**
1. **Höhen-Normalisierung auf $1.0\text{m}$:** Mixamo-FBX exportiert in cm ($0.01$ Skalierungsfaktor), wodurch das Modell nach `fbx2gltf` nur $0.018\text{m}$ (1.8 cm) groß wäre. Der Root-Knoten (`Node 0`) wird skaliert, sodass die Netto-Höhe exakt $1.0\text{m}$ beträgt (damit `character.scale.set(1.8, 1.8, 1.8)` in der Engine exakt $1.80\text{m}$ Mensch-Höhe ergibt).
2. **Entfernen des statischen 1-Frame-Mixamo-Clips:** `fbx2gltf` bittet einen Dummy-Clip namens `"mixamo.com"` ein. Dieser wird entfernt, damit Small World Machine automatisch die Shared Studio Mocap Clips lädt.
3. **Knochen-Check:** $\le 65$ Joints, saubere `mixamorig:*` Nomenklatur.

---

## 🍳 Rezept 4: Motion Library & Prop-Stabilisierung

1. **In-Place Mandat:**
   * Animationen müssen immer **In-Place** sein (`--animate-in-place` bei Tripo, Checkbox *„In Place“* bei Mixamo).
   * *Grund:* Bewegung und Positionsfortschritt werden von Small World Machine Behaviors (`StageMovementBehavior`, `FPSController`) gesteuert. Root-Motion im Clip führt zu Glitches.
2. **Prop-Tragehaltung (Laterne, Fackel, Waffe):**
   * Verwende für Figuren mit Ausrüstung dedizierte Studio-Mocap-Clips mit fixiertem Tragearm (z. B. `idle_torch.glb`, `walk_torch.glb`, `ascending_stairs.glb`).
   * Generische AI-Walk-Zyklen schwingen oft wild mit den Armen, was zu taumelnden Props führt.
3. **Knochen-Präfix Aliasing:**
   * [`AnimationMixer.ts`](src/core/animation/AnimationMixer.ts) normalisiert automatisch Präfixe (`mixamorig:`, `mixamorig1:`), sodass Clips universell binden.

---

## 🍳 Rezept 5: Small World Machine-Integration

### 1. Skalierung & der Rig-Wrapper (Kritischer Bug-Schutz)
> **🚨 GOLDENE REGEL:** Niemals `character.scale.set(1.8, 1.8, 1.8)` auf dem Objekt setzen, an dem ein `StageMovementBehavior` hängt! Das Behavior überschreibt `.scale` im Tick mit dem Zonen-Faktor (0.5–1.0).

**Das korrekte Wrapper-Pattern:**
```typescript
import { Object3D, StageMovementBehavior } from "small-world-machine";
import { GltfLoader } from "small-world-machine/loaders/GltfLoader";

const gltfLoader = new GltfLoader({
  clampMetallic: 0.2,   // Drosselt überhöhte Tripo-PBR Metallic-Werte
  clampRoughness: [0.3, 1.0]
});

// 1. Charakter laden und lokale 1.80m Skalierung setzen
const character = await gltfLoader.load("/assets/and-now/mannequin/novotny-male/character.glb");
character.scale.set(1.8, 1.8, 1.8);

// 2. Rig-Wrapper erstellen (Position & Behavior hier anhängen)
const characterRig = new Object3D("CharacterRig");
characterRig.add(character);

const movement = new StageMovementBehavior(zones, { speed: 2.0 });
characterRig.addBehavior(movement);

scene.add(characterRig);
```

### 2. Shading & Graphic Noir Look
Für 2.5D Comic/Noir Szenen ohne volles IBL-Environment:
```typescript
import { BasicMaterial, Color, Object3D } from "small-world-machine";

function applyGraphicNoirMaterial(obj: Object3D): void {
  if (obj.material) {
    const basic = new BasicMaterial({ color: new Color(1, 1, 1) });
    if (obj.material.diffuseMap) {
      basic.diffuseMap = obj.material.diffuseMap;
    }
    obj.material = basic;
  }
  for (const child of obj.children) {
    applyGraphicNoirMaterial(child);
  }
}
applyGraphicNoirMaterial(character);
```

### 3. Semantischer Prop-Socket (z. B. Laterne in linker Hand)
```typescript
const HAND_BONES = [
  "mixamorig:LeftHand",
  "mixamorig1:LeftHand",
  "L_Hand",
  "tripo::0_Left_Limb_2",
  "tripo::0_Left_Limb_3",
];

let handBone: Object3D | undefined;
for (const name of HAND_BONES) {
  const found = character.getObjectByName(name);
  if (found) {
    handBone = found;
    break;
  }
}

if (handBone) {
  const propSocket = new Object3D("LanternSocket");
  // Offset in die Handfläche & 90° Z-Drehung, damit Laterne senkrecht zum Boden hängt
  propSocket.position.set(0.01, 0.09, 0.02);
  propSocket.rotation.set(0, 0, Math.PI / 2);
  
  propSocket.add(lanternMesh);
  propSocket.add(pointLight);
  handBone.add(propSocket);
}
```

---

## 🍳 Rezept 6: High-Fidelity Textur- & Material-Architektur (Profi-Standard)

Um maximale Bildschärfe und Texturqualität bei Mixamo-gestützten Charakteren sicherzustellen, befolgt die Engine 4 fundamentale Prinzipien:

### 1. Entkopplung von Rig und Textur (Keine Mixamo-Re-Kompression)
* **Prinzip:** Mixamo wird **ausschließlich als Knochen- und Gewichtungs-Rechner** genutzt.
* **Pipeline-Garantie:** Die in Mixamo Web sichtbare WebGL-Vorschau ist stark komprimiert und unvollständig. Unser Konvertierungs-Skript re-injiziert beim Erzeugen der finalen `character.glb` immer die unkomprimierte 2K-Originaltextur (`texture.jpg`) aus dem Quell-Modell, sodass null Qualitätsverlust durch den Mixamo-Server entsteht.

### 2. PBR- & Graphic-Noir Material-Härtung
* **Metallic & Roughness Clamping:** Tripo neigt dazu, Kunststoff- und Stoff-Flächen mit zu hohen Metallic-Werten zu versehen. Der `GltfLoader` drosselt diese via `clampMetallic: 0.2` und `clampRoughness: [0.3, 1.0]`.
* **Graphic-Noir Pipeline:** Für stilisierte Comic-/Noir-Welten wird die Albedo-Map via `BasicMaterial` mit dynamischem Kerosinlampen-Licht (`PointLight`) und Kanten-Shadern kombiniert, wodurch feine Inking-Linien selbst in Bewegung gestochen scharf bleiben.

### 3. Textur-Filterung & Anisotropie (Anti-Blur)
* Im WebGL2/WebGPU Renderer müssen Texturen zwingend mit Mipmaps (`generateMipmaps = true`) und maximaler anisotroper Filterung (`TEXTURE_MAX_ANISOTROPY_EXT` bis 16x) gerendert werden, um Unschärfe bei flachen Kamerawinkeln (Isometrie, Guckkasten-Schräge) zu eliminieren.

### 4. Transparenz- & Normal-Map-Schutz
* **Transparenz-Schutz:** Der Material-Loader forciert für Charakter-Körper standardmäßig `alphaMode = "OPAQUE"`, um den berüchtigten Mixamo-Fehler zu verhindern, bei dem Kleidung oder Hautteile fälschlicherweise als gläsern oder halbtransparent gerendert werden.
* **Non-Color Normal Data:** Normal-Maps werden strikt im linearen Farbraum (Non-Color Data) interpretiert, um blockige Schattierungs-Artefakte zu verhindern.

---

### 4. AnimationMixer & Cross-Fading
```typescript
import { AnimationMixer, AnimationClip, AnimationAction } from "small-world-machine";

const mixer = new AnimationMixer(character);

// Eingebettete Clips bevorzugen, ansonsten Studio-Clips aus shared/anim/ laden
let walkClip = character.animations?.find(a => a.name === "preset:walk");
if (!walkClip) {
  const loaded = await gltfLoader.loadAnimations("/assets/and-now/mannequin/shared/anim/walk_torch.glb");
  walkClip = loaded[0];
}

let activeAction: AnimationAction | undefined;

function play(clip: AnimationClip, fadeSec: number = 0.25): void {
  const next = mixer.clipAction(clip);
  if (activeAction && activeAction !== next) {
    activeAction.crossFadeTo(next, fadeSec, true);
  }
  next.play();
  activeAction = next;
}
```

---

## 🍳 Rezept 6: Dateistruktur & Namenskonventionen

Strikte Trennung nach **Figuren-Ordnern** statt nach Asset-Typen:

```text
public/assets/<app>/mannequin/
├── novotny-male/
│   └── character.glb                 # Geriggtes Laufzeit-Modell (inkl. Textur)
├── novotny-female/
│   └── character.glb
└── shared/
    └── anim/                         # Figurenübergreifende Mocap-Clips
        ├── idle_torch.glb
        ├── walk_torch.glb
        └── ascending_stairs.glb

src/apps/<app>/raw/mannequin/
├── novotny-male/                     # .gitkeep, DCC-Quellen, task.json
├── novotny-female/
├── spacegirl/                        # Konzeptbilder & Model-Sheets
└── shared/                           # Original .fbx Mocap-Dateien
```
*Regel:* Dateinamen wiederholen den Figurennamen **nicht** im Dateinamen (`character.glb`, nicht `novotny-male.glb`).

---

## 🛠️ Rezept 7: Troubleshooting Runbook

| Symptom | Ursache | Sofort-Lösung |
| :--- | :--- | :--- |
| **Figur winzig / Puppenhaltung** | `StageMovementBehavior` hat die 1.8er Skalierung überschrieben. | Charakter in `_characterRig` (`Object3D`) einbetten und Behavior auf das Rig setzen. |
| **Laterne schwebt waagerecht** | Hand-Bone hat $X$-Achse Richtung Boden, Laterne fehlt Ausrichtungs-Offset. | Socket mit `position.set(0.01, 0.09, 0.02)` und `rotation.set(0, 0, Math.PI / 2)` versehen. |
| **Gliedmaßen reißen beim Gehen ab** | Rig hat Twist-Hilfsknochen, die im Motion-Clip fehlen und einfrieren. | Mixamo-Standard-Rig nutzen oder Tripo-Retarget direkt gegen das native Tripo-Rig fahren. |
| **Körperteile bewegen sich nicht / verzerren** | Skelett überschreitet das 64-Bone-Limit des WebGL2-Shaders (`u_boneMatrices[64]`). | Rig auf $\le 64$ Bones reduzieren (Spring-Bones auf übergeordnete Joints binden). |
| **Figur ist komplett pechschwarz** | Tripo exportiert PBR mit `metallic: 1.0` ohne passendes IBL/HDRI. | Im `GltfLoader` `clampMetallic: 0.2` setzen oder auf `BasicMaterial` mit `diffuseMap` umstellen. |
| **Turnaround hat Flecken / Schatten** | Konzeptbild hatte gebackenes Chiaroscuro-Licht. | Prompt mit *„Pure unshaded flat Albedo diffuse, zero shadows, pure white background“* re-generieren. |
| **Bein verschwindet / wird von der Hüfte verdeckt** | Perspektivische Bein-Überlappung bei bestimmten Kamerawinkeln + Posen. | Siehe die bebilderte Tiefen-Erklärung `.agents/notes/reference/bein-verdeckung.html` ("Warum das Bein verschwindet"). |

---

## ✅ Quality Gate Checkliste (Vor Release abhaken)

- [ ] **Albedo:** Textur ist schattenfrei und neutral ausgeleuchtet.
- [ ] **Budget:** Mesh $\le 25.000$ Triangles, Texturatlas $\le 2048\times 2048$ (2K).
- [ ] **Rig:** Entweder sauberes Mixamo-Rig oder Tripo-Rig auf $\le 64$ Bones gestutzt.
- [ ] **Motion:** Locomotion-Clips laufen **In-Place** (`--animate-in-place`).
- [ ] **Props:** Ausrüstung sitzt stabil im Hand-Socket ohne Taumeln.
- [ ] **Skalierung:** 1.80m Human Scale ist über `_characterRig` gekapselt.
- [ ] **Pfade:** Runtime unter `public/assets/`, DCC-Quellen unter `src/apps/<app>/raw/`.

