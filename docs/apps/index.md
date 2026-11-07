# Spiele & Welten

Produktions-Vertical-Slices und Referenzprojekte, die auf der Small World Machine aufbauen.

## Monorepo-Apps

Integrierte Prototypen und Werkzeuge direkt im Engine-Repository:

| App | Typ | Beschreibung |
|---|---|---|
| [Light Cycle Arena](./light-cycle-arena.md) | Sample App | Retro-Future-Arena-Actionspiel mit Trail-Rendering und Grid-Physik. |
| [Maker — 3D-Welteneditor & Level-Designer](./maker.md) | Tool Suite | Standalone-Welteneditor als eigenständige App (siehe auch [Maker-Anleitung](/guides/maker) und [ADR 0010](/adr/0010-maker-editor-architecture)). |

---

## Eigenständige Standalone-Projekte

Vollständige Spiele, die in eigenen Repositories leben und die Small World Machine als reines npm-Paket konsumieren („Max-Mustermann-Test“):

| Projekt | Genre | Highlights | Repository |
|---|---|---|---|
| [YAD (Yet Another Dungeon)](./yad.md) | Retro First-Person Grid-Crawler | 3D-Billboards, Retro-HUD, Sprite-Animationen, Soundscape | [rottensteiner-stefan/yad ↗](https://github.com/rottensteiner-stefan/yad){target="_blank"} |
| [Minceraft](./minceraft.md) | Voxel World Sandbox | Multi-Worker Greedy Meshing, Vertex Daylight/AO, OPFS-Deltas | [rottensteiner-stefan/minceraft ↗](https://github.com/rottensteiner-stefan/minceraft){target="_blank"} |

