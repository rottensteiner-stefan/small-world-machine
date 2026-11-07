# YAD — Yet Another Dungeon

> **Genre:** Retro First-Person Grid-Crawler  
> **Rendering:** Hybrid WebGL2 / WebGPU mit 3D-Billboard-Sprites und dynamischer Beleuchtung  
> **Repository:** [github.com/rottensteiner-stefan/yad](https://github.com/rottensteiner-stefan/yad){target="_blank"}  
> **Lizenz:** MIT (Open Source)

---

## 🗡️ Überblick

**YAD (Yet Another Dungeon)** ist ein eigenständiges Retro-Dungeon-Crawler-Spiel im Stil klassischer Dungeon-Crawler der 90er-Jahre (*Dungeon Master*, *Eye of the Beholder*, *DooM*), das vollständig auf der Small World Machine aufbaut.

Das Spiel demonstriert, wie ein vollständiges Projekt die Engine als externes npm-Paket konsumiert – ohne Zugriff auf Engine-Quellcode, mit strikter Einhaltung der Zero-GC-Regeln und sauber getrennten Assets.

```text
       [ YAD Standalone Game ]
                 │
                 ▼  (pinned release URL)
      [@small-world-machine/engine]
```

---

## ⚡ Kernfeatures & Architektur

* **First-Person Grid-Movement:** Diskrete Bewegung auf einem 2D-Gitter mit flüssiger Kamera-Interpolation und Kollisionsabfrage.
* **Sprite- & Billboard-Rendering:** Gegner, Projektile und Deko-Elemente werden als 3D-Billboards mit pixel-perfekter Ausrichtung gerendert.
* **Retro-HUD:** Eigenes 2D-Canvas-HUD für Gesundheit, Rüstung, animiertes Porträt, Waffenanzeige und Munitionszähler.
* **KI & Gegnerverhalten:** Zustandsgesteuerte Gegnerlogik (`EnemyBehavior`) mit dynamischer Sichtlinienerkennung, Verfolgung und Nahkampf-Reichweitenprüfung.
* **Dungeon-Generierung:** Prozedurale und gitterbasierte Raumgenerierung mit animierten Fackellichtern, Türen und Fallen.
* **Audio-Soundscape:** Integriertes Sound-Management für Schritte, Waffen, Monstergeräusche und Trefferfeedback.

---

## 📦 Standalone-Konsum

YAD bindet die Engine in seiner `package.json` als Paket ein:

```json
{
  "dependencies": {
    "@small-world-machine/engine": "https://github.com/rottensteiner-stefan/small-world-machine/releases/download/packages-0.122.0/small-world-machine-engine-0.122.0.tgz"
  }
}
```

Der Quellcode und alle Assets sind im Repository [rottensteiner-stefan/yad](https://github.com/rottensteiner-stefan/yad){target="_blank"} verfügbar.
