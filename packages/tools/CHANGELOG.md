# Changelog - @small-world-machine/tools

All notable changes to this package will be documented in this file.
This package adheres to [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-27

- **Added:** Public scripting and developer API `MakerApi` (`makerApp.api` / `window.maker`) with `loadProp()`, `loadCharacterLineup()`, `getUserObjects()`, `clearUserObjects()`, `select()`, `focus()`, and `setMode()`.
- **Added:** Character kit `Figures` subfolder grouping, one-click `All Figures (Lineup)` preset in `ContentDrawer`, and `?lineup=characters` / `?figures=1` URL query auto-lineup in Maker.

## [0.1.0] - 2026-11-07

- **Added:** Initial modular release of standalone development, authoring, and diagnostic tools.
- **Added:** Desktop-style floating/docking window manager (`Forge`, `ForgeWindow`, `ForgeTheme`).
- **Added:** 3D World and Scene Editor (`MakerApp`, HierarchyPanel, PropertyPanel, ContentDrawer, ToolModeHost, UndoStack).
- **Added:** Diagnostic authoring tools: `MaterialStudio`, `Pixler`, `Xtractor`, `MapGenerator`, and `KitInspectorApp`.
- **Added:** Image-based lighting precomputation suite (`ibl-gen`).
