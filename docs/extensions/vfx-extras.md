# VFX Extras (`@small-world-machine/vfx-extras`)

Das Paket `@small-world-machine/vfx-extras` bietet eine hochperformante, speicherallocationsfreie Partikel- und Kraftfeld-Pipeline für Small World Machine. Es ermöglicht komplexe astrophysikalische Phänomene, Magieeffekte, Feuer, Rauch und dichte Partikelschwärme mit tausenden Instanzen bei 60 FPS in einem einzigen GPU Draw Call.

## Installation & Import

```bash
npm install @small-world-machine/vfx-extras
```

```typescript
import {
  ParticleSystem,
  ParticleMeshRenderer,
  AccretionDiskEmitter,
  PointAttractorAffector,
  VortexAffector,
  TurbulenceAffector,
  DragAffector,
  ColorOverLifeAffector,
  SizeOverLifeAffector,
  BouncePlaneAffector,
} from "@small-world-machine/vfx-extras";
```

---

## Kernkomponenten

### 1. `ParticleSystem`
Verwaltet einen fest allokierten Ringpuffer (`capacity`) von `Particle`-Instanzen. Unterstützt kontinuierliche Emission, Burst-Spawns, Lebenszeitverwaltung und das Hinzufügen beliebiger Affektoren.

```typescript
const system = new ParticleSystem({
  capacity: 2000,
  onParticleDied: (p) => {
    // Optionaler Respawn-Callback
  },
});
```

### 2. `ParticleMeshRenderer`
Schlägt die Brücke zwischen dem CPU-Partikelsystem und der GPU-Instanzierung (`InstancedMesh`).

* **1 Draw Call:** Alle aktiven Partikel werden als Instanzen eines gemeinsamen Basis-Meshes gerendert.
* **Zero GC:** Instanz-Transformationsmatrizen ($16 \times \text{Float32}$) und optionale Farb-Puffer ($4 \times \text{Float32}$, RGBA) werden direkt im Float32Array aktualisiert.
* **Instanz-Kollaps:** Tote oder unsichtbare Partikel ($\alpha \approx 0$) werden auf eine Matrix-Skalierung von $0$ gesetzt und belasten die GPU nicht.

```typescript
import { Sphere, StandardMaterial } from "@small-world-machine/engine";

const renderer = new ParticleMeshRenderer({
  system,
  geometry: new Sphere({ radius: 0.05 }).getGeometryData(),
  material: new StandardMaterial(),
  enableColorBuffer: true,
});

scene.add(renderer.mesh);

// Im Game-Loop / Animation-Frame:
system.update(dt);
renderer.sync();
```

---

## Universelle Affektor-Bibliothek

Affektoren modifizieren Partikelzustände (`position`, `velocity`, `acceleration`, `color`, `size`, `alpha`, `heat`) pro Zeitschritt $\Delta t$.

| Affektor | Formel / Wirkungsweise | Typischer Einsatz |
|---|---|---|
| **`PointAttractorAffector`** | $F = \frac{G \cdot M \cdot r}{(r^2 + \epsilon^2)^{3/2}}$ (Plummer-Potential) | Gravitation, Schwarze Löcher, Magnetismus, Sog |
| **`VortexAffector`** | Tangentiale Drehbeschleunigung $\mathbf{v}_{\perp}$ + Zentripetalsog | Wirbelstürme, Strudel, Spiralgalaxien, Akkretionsscheiben |
| **`PlanarSpringAffector`** | $F_y = -k \cdot y - d \cdot v_y$ (Dämpfungsschwingung) | Orbitale Scheibenstabilisierung, Wellenflächen |
| **`ThermalCoolingAffector`** | Kompressionserwärmung + radiative Planck-Kühlung | Glutpartikel, Plasma, Akkretionsscheiben, Schweißfunken |
| **`FadeOutZoneAffector`** | $\alpha = \text{clamp}\left(\frac{r - r_{in}}{r_{out} - r_{in}}, 0, 1\right)$ | Gravitative Rotverschiebung, Ereignishorizont, Absorption |
| **`TurbulenceAffector`** | Trigonometrischer 3D-Curl-Noise $\nabla \times \mathbf{A}$ | Rauchwirbel, atmosphärische Böen, Flammen |
| **`DragAffector`** | $\mathbf{F}_{\text{drag}} = -(\gamma_1 + \gamma_2 \|\mathbf{v}\|) \mathbf{v}$ | Luft-/Wasserwiderstand, Verlangsamung im Medium |
| **`ColorOverLifeAffector`** | Farb- und Alpha-Gradient über Lebensdauer $t \in [0, 1]$ | Farbverlauf von Feuer nach Rauch, Magieschweife |
| **`SizeOverLifeAffector`** | Skalierungsverlauf über Lebensdauer | Explosionen, expandierende Rauchwolken |
| **`BouncePlaneAffector`** | Elastische Kollisionsreflexion an Ebene ($y = y_0$) | Funken auf Boden, Regentropfen, Trümmer |

---

## Beispiel: Akkretionsscheiben-Simulation (`AccretionDiskEmitter`)

Ein hochstufiges, schlüsselfertiges System zur astrophysikalischen Simulation einer Akkretionsscheibe mit Kepler-Rotationsprofil:

$$v_{\text{orbit}}(r) = \sqrt{\frac{M}{r}} \cdot f_{\text{drift}}$$

```typescript
const accretionDisk = new AccretionDiskEmitter({
  particleCount: 1500,
  innerRadius: 0.6,
  outerRadius: 3.2,
  eventHorizonRadius: 0.35,
  fadeStartRadius: 0.55,
  mass: 1500,
  diskThickness: 0.15,
  driftFactor: 0.985,
});

const renderer = new ParticleMeshRenderer({
  system: accretionDisk.system,
  geometry: new Sphere({ radius: 0.04 }).getGeometryData(),
  material: new StandardMaterial(),
});

scene.add(renderer.mesh);

// Im Render-Loop:
accretionDisk.update(dt);
renderer.sync();
```
