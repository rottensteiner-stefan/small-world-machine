export const GROUT_THICKNESS_PX = 5.5; // half-grout drawn per tile cell -> 11px full grout line
export const TILE_CELL_PX = 128; // 8x8 tiles in 1024x1024 texture
export const TILE_UNIT_SIZE = 0.142; // ~14.2cm per tile unit (tile + center grout)
export const WALL_THICKNESS = 2 * TILE_UNIT_SIZE; // exactly 2 tiles = ~0.284m
export const POOL_TILES_OUTER = 35; // 35 tiles along outer edge
export const POOL_SIZE = POOL_TILES_OUTER * TILE_UNIT_SIZE; // ~4.970m
export const WALL_HEIGHT = 1.5;
export const WALL_CENTER_Y = -0.65; // top curb face at +0.10 (subtle 5cm curb above ground)
export const FLOOR_Y = -1.35;
export const LIQUID_Y = 0.05; // flush just below the +0.10 curb top

export type PoolKey =
  | "clear-water"
  | "toon-water"
  | "bold-anime"
  | "soft-watercolor"
  | "painterly-sparkle"
  | "dredge"
  | "noir-graphic"
  | "molten-lava"
  | "toxic-slime"
  | "petroleum-oil"
  | "wave-rider"
  | "dead-sea"
  | "lava-volcanic"
  | "lava-infernal"
  | "lava-plasma"
  | "lava-toxic";

export interface PoolPosition {
  x: number;
  z: number;
}

/**
 * The pool gallery is a 4 x 4 grid, one pool per cell. This table is the single source of truth:
 * pool positions, meadow cutouts, signboards and the golden cameras are all derived from it.
 * Row 0 (north): realistic water and the buoyancy pools; row 1: stylized anime/painterly water;
 * row 2: dark and exotic fluids. Row 3 extends the gallery southward as a stylized-lava terrace;
 * `POOL_GRID_ROWS` stays 3 so the existing rows keep their world positions (and goldens).
 */
export const POOL_GRID_COLUMNS = 4;
export const POOL_GRID_ROWS = 3;
export const POOL_PITCH_X = 9;
export const POOL_PITCH_Z = 15;
export const POOL_CELLS: Readonly<Record<PoolKey, { col: number; row: number }>> = {
  "clear-water": { col: 0, row: 0 },
  "wave-rider": { col: 1, row: 0 },
  "dead-sea": { col: 2, row: 0 },
  "toon-water": { col: 3, row: 0 },
  "bold-anime": { col: 0, row: 1 },
  "soft-watercolor": { col: 1, row: 1 },
  "painterly-sparkle": { col: 2, row: 1 },
  dredge: { col: 3, row: 1 },
  "noir-graphic": { col: 0, row: 2 },
  "molten-lava": { col: 1, row: 2 },
  "toxic-slime": { col: 2, row: 2 },
  "petroleum-oil": { col: 3, row: 2 },
  "lava-volcanic": { col: 0, row: 3 },
  "lava-infernal": { col: 1, row: 3 },
  "lava-plasma": { col: 2, row: 3 },
  "lava-toxic": { col: 3, row: 3 },
};

/** World-space pool center of a grid cell (the grid is centered on the world origin). */
export function poolWorldPosition(key: PoolKey): PoolPosition {
  const cell = POOL_CELLS[key];
  return {
    x: (cell.col - (POOL_GRID_COLUMNS - 1) / 2) * POOL_PITCH_X,
    z: (cell.row - (POOL_GRID_ROWS - 1) / 2) * POOL_PITCH_Z,
  };
}
