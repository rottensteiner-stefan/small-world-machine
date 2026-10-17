import type { GridLegend, GridLegendEntry } from "@small-world-machine/engine";
import { Object3D, StandardMaterial, Color, Cube } from "@small-world-machine/engine";

/** Character -> (label, color) for Maker's default ASCII-import legend -- deliberately its own
 * small palette, not an import of `MapGenerator`'s internal `_palette` field: this is Maker's own
 * "reasonable starting point" mapping (see ADR 0010 Phase 2C), not a hard coupling to
 * `MapGenerator`'s implementation. Kept the same characters/colors anyway since a map painted in
 * MapGenerator should still look recognizable once imported. */
const MARKER_PALETTE: Record<string, { label: string; color: Color }> = {
  "+": { label: "Door", color: new Color(0, 1, 0) },
  O: { label: "Secret", color: new Color(0, 0.33, 0) },
  P: { label: "PlayerStart", color: new Color(0, 0, 1) },
  E: { label: "Enemy", color: new Color(1, 0, 0) },
  b: { label: "Barrel", color: new Color(0.63, 0.32, 0.18) },
  I: { label: "Item", color: new Color(1, 0.84, 0) },
  l: { label: "Torch", color: new Color(1, 0.67, 0) },
  T: { label: "Lava", color: new Color(1, 0.33, 0) },
  "~": { label: "Slime", color: new Color(0, 1, 0.67) },
};

const cubeGeometry = new Cube({ size: 1 }).getGeometryData();
const markerGeometry = new Cube({ size: 0.4 }).getGeometryData();

function wallEntry(color: Color): GridLegendEntry {
  return {
    type: "custom",
    onBuild: (x, y, worldX, worldZ): Object3D => {
      const block = new Object3D(`Wall_${x}_${y}`);
      block.geometry = cubeGeometry;
      block.material = new StandardMaterial({ color, metallic: 0, roughness: 0.8 });
      block.position.set(worldX, 1, worldZ);
      block.scale.set(1, 2, 1);
      block.isStatic = true;
      return block;
    },
    preventFloorCeiling: true,
  };
}

function markerEntry(char: string, counter: { count: number }): GridLegendEntry {
  const { label, color } = MARKER_PALETTE[char]!;
  return {
    type: "custom",
    onBuild: (_x, _y, worldX, worldZ): Object3D => {
      const marker = new Object3D(`${label}_${counter.count++}`);
      marker.geometry = markerGeometry;
      marker.material = new StandardMaterial({ color, metallic: 0, roughness: 0.6 });
      marker.position.set(worldX, 0.2, worldZ);
      return marker;
    },
    // A floor tile still generates underneath every marker -- markers sit *on* the ground, they
    // don't replace it, matching how MapGenerator itself treats non-wall characters.
  };
}

/**
 * Maker's default legend for the "Import ASCII Map" bridge -- see
 * docs/adr/0010-maker-editor-architecture.md Phase 2C. Deliberately a rough starting scaffold:
 * walls become solid blocks, everything else becomes a small colored marker cube on the floor
 * (or nothing, for `.`/unrecognized characters) -- the point is a fast, editable base the user
 * refines by hand afterward in Maker, not a finished level.
 */
export function defaultAsciiMapLegend(): GridLegend {
  const counter = { count: 0 };
  const legend: GridLegend = {
    W: wallEntry(new Color(0.33, 0.33, 0.33)),
    G: wallEntry(new Color(0.27, 0.27, 0.27)),
  };
  for (const char of Object.keys(MARKER_PALETTE)) {
    legend[char] = markerEntry(char, counter);
  }
  return legend;
}
