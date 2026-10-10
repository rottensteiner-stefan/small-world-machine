# Maker — 3D-Welteneditor & Level-Designer

> **Kategorie:** Integrierter WebGL2/WebGPU 3D-Szeneneditor  
> **Features:** Transform-Gizmos, Asset-Browser, PBR-Material-Inspektor, Multi-Viewport, Undo/Redo

---

## 🚀 Direktzugänge & Editor

| Modul | Typ | Link |
| :--- | :--- | :--- |
| **🏗️ Maker Studio starten** | Editor | [Maker im Browser starten](/small-world-machine/showcases/tools/maker.html){target="_blank"} |
| **📖 Maker Konzept-Dossier** | Web-Dossier | [Dossier öffnen](/small-world-machine/showcases/packages/tools/src/maker/docs/concept-dossier.html){target="_blank"} |

---

## 🛠️ Kernarchitektur (ADR 0010)

* **Multi-Format glTF-Export:** Exportiert vollständige Szenengraphen mit benutzerdefinierten Extensions.
* **Undo/Redo Command-Pattern:** Vollständig deterministische Aktions-Historie.
* **StageZone-Editor:** Visuelle Definition von 2.5D-Bühnen und Navigationspfaden direkt im 3D-Raum (ADR 0016).
