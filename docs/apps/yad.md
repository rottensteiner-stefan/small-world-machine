# YAD — Yet Another Dungeon

> **Genre:** 2.5D Isometrischer Dungeon-Crawler / Rogue-Lite  
> **Rendering:** Hybrid WebGL2 / WebGPU mit dynamischem Point-Light-Shadowing  
> **Steuerung:** Tastatur / Gamepad / Touch

---

## 🚀 Direktzugänge & Spiel

| Modul | Typ | Link |
| :--- | :--- | :--- |
| **🎮 YAD Spiel starten** | Playable App | [Spiel im Vollbild starten](/small-world-machine/showcases/apps/sample-apps/yad/index.html){target="_blank"} |
| **📖 Konzept-Dossier** | Web-Dossier | [Dossier öffnen](/small-world-machine/showcases/apps/sample-apps/yad/docs/concept-dossier.html){target="_blank"} |

---

## ⚔️ Spielmechaniken & Architektur

* **Isometrische Kamera:** Feste 45°-Isometrie mit stufenlosem Zoom und dynamischer Zielverfolgung.
* **Prozedurales Level-Layout:** Raum- und Ganggitter-Generierung basierend auf dem `MapGenerator`.
* **Kollisions- & Physik-Pipeline:** Raycaster- & AABB-Kollision mit Feind-KI (`EnemyBehavior`) und Fallen.
* **Beleuchtung:** Fackel-Lichtquellen mit dynamischem Flackern (`FlickerBehavior`) und farbigen Umgebungsreflektionen.
