import { GltfBinaryParser, GltfLoader, Vector3D } from "@small-world-machine/engine";
import type { GltfData, Object3D, Ray, AssetManager } from "@small-world-machine/engine";

/** Matches the piece root nodes of the Khronos `ABeautifulGame` chess set. */
const PIECE_NAME = /^(King|Queen|Castle|Knight|Bishop|Pawn_Body)_([WB])(\d*)$/;
const KIND_BY_PREFIX: Record<string, PieceKind> = {
  King: "king",
  Queen: "queen",
  Castle: "rook",
  Knight: "knight",
  Bishop: "bishop",
  Pawn_Body: "pawn",
};

/** Visual feedback constants (world units; the board field is ~0.44 units wide). */
const HOVER_SCALE = 1.035;
const DRAG_SCALE = 1.04;
const LIFT_Y = 0.04;

export type PieceKind = "king" | "queen" | "rook" | "knight" | "bishop" | "pawn";
export type PieceColor = "W" | "B";
export type LoadPhase = "download" | "decode" | "prepare";

export interface ChessPiece {
  /** Imported node name, e.g. `King_W` or `Pawn_Body_B3`. */
  name: string;
  kind: PieceKind;
  color: PieceColor;
  /** Piece root node. Moved by drag; its `position` is world-space because `glTF_Root` is identity. */
  node: Object3D;
  /** Initial position (restored by {@link ChessSet.resetBoard}). */
  home: Vector3D;
  /** Pickable geometry leaves (a pawn has body + top meshes). */
  meshes: Object3D[];
}

/** Axis-aligned 8x8 square lattice derived from the piece home positions (no hardcoded numbers). */
export interface ChessLattice {
  stepX: number;
  stepZ: number;
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Facts read from the parsed glTF document, for the session readout and QA hook. */
export interface ChessSetStats {
  bytes: number;
  meshCount: number;
  triangleCount: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
  copyright: string | undefined;
}

export interface ChessProgress {
  phase: LoadPhase;
  loaded: number;
  total: number;
}

/**
 * The interactive chess set of Showcase 50: streams the official Khronos `ABeautifulGame`
 * KTX-ETC1S-Draco GLB straight from GitHub with byte-level progress (`AssetManager.streamBinary`),
 * parses it through the engine `GltfLoader` (Draco + Basis Universal decode via the opt-in
 * `@small-world-machine/gltf-extensions` package), enumerates the 32 grabbable pieces, derives the
 * board lattice from their home positions and owns drag/hover/reset behaviour.
 *
 * Picking design: the piece leaf meshes are pickable (precise triangle raycast, pieces stand close
 * together), but every pointer event is forwarded to this controller and applied to the piece ROOT
 * node, so multi-mesh pawns (body + top) always move as one. The engine only exposes single-slot
 * pointer callbacks on `Object3D`, so this class is the only consumer per mesh.
 */
export class ChessSet {
  public readonly root: Object3D;
  public readonly pieces: ChessPiece[] = [];
  public readonly stats: ChessSetStats;
  public readonly lattice: ChessLattice = {
    stepX: 0,
    stepZ: 0,
    originX: 0,
    originZ: 0,
    cols: 8,
    rows: 8,
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
  /** `true` snaps dragged pieces onto the derived board lattice; `false` allows free placement. */
  public gridSnap: boolean = true;
  /** Notified when hover or drag state changes (HUD readout refresh). */
  public onActivityChange?: () => void;

  private _hovered: ChessPiece | null = null;
  private _dragged: ChessPiece | null = null;
  private _dragPlaneY: number = 0;
  private readonly _dragOffset: Vector3D = new Vector3D();

  private constructor(root: Object3D, stats: ChessSetStats) {
    this.root = root;
    this.stats = stats;
  }

  /**
   * Streams, decodes and parses the remote chess set. `onProgress` reports real downloaded bytes
   * (phase `"download"`) and then marks the compute phases. Runs on the caller's thread (WASM
   * decoders are main-thread by design of the opt-in package).
   */
  public static async loadRemote(
    assetManager: AssetManager,
    url: string,
    onProgress: (p: ChessProgress) => void,
  ): Promise<ChessSet> {
    onProgress({ phase: "download", loaded: 0, total: 0 });
    const bytes = await assetManager.streamBinary(url, undefined, (loaded: number, total: number) =>
      onProgress({ phase: "download", loaded, total }),
    );
    onProgress({ phase: "decode", loaded: bytes.byteLength, total: bytes.byteLength });

    const data: GltfData = GltfBinaryParser.parseGlb(bytes);
    const loader = new GltfLoader({ assetManager });
    const root = await loader.parse(data, url);
    onProgress({ phase: "prepare", loaded: bytes.byteLength, total: bytes.byteLength });

    const stats: ChessSetStats = {
      bytes: bytes.byteLength,
      meshCount: 0,
      triangleCount: 0,
      extensionsUsed: data.json.extensionsUsed ?? [],
      extensionsRequired: data.json.extensionsRequired ?? [],
      // The glTF `asset` object is schema-open; the Khronos `ABeautifulGame` file carries `copyright`.
      copyright: data.json.asset?.["copyright"] as string | undefined,
    };

    const set = new ChessSet(root, stats);
    set._measureScene();
    set._scan();
    set._deriveLattice();
    set._attach();
    return set;
  }

  public get hovered(): ChessPiece | null {
    return this._hovered;
  }

  public get dragged(): ChessPiece | null {
    return this._dragged;
  }

  /** Square label (`a1`..`h8`) at the piece's current position. */
  public squareOf(piece: ChessPiece): string {
    const p = piece.node.position;
    const f = ChessSet._clamp(
      Math.round((p.x - this.lattice.originX) / this.lattice.stepX),
      0,
      this.lattice.cols - 1,
    );
    const r = ChessSet._clamp(
      Math.round((p.z - this.lattice.originZ) / this.lattice.stepZ),
      0,
      this.lattice.rows - 1,
    );
    return `${String.fromCharCode(97 + f)}${r + 1}`;
  }

  public setGridSnap(on: boolean): void {
    this.gridSnap = on;
    // Re-snap the piece that is currently being dragged so the toggle takes effect immediately.
    if (this._dragged) {
      const pos = this._dragged.node.position;
      this._constrain(pos);
      pos.y = this._dragPlaneY + LIFT_Y;
    }
    this.onActivityChange?.();
  }

  public resetBoard(): void {
    for (const piece of this.pieces) {
      piece.node.position.copyFrom(piece.home);
      piece.node.scale.set(1);
    }
    this._hovered = null;
    this._dragged = null;
    this.onActivityChange?.();
  }

  /** Removes the pickability flags and pointer callbacks (showcase teardown / renderer swap). */
  public dispose(): void {
    for (const piece of this.pieces) {
      for (const mesh of piece.meshes) {
        mesh.isPickable = false;
        mesh.onPointerEnter = undefined;
        mesh.onPointerLeave = undefined;
        mesh.onPointerDown = undefined;
        mesh.onPointerMove = undefined;
        mesh.onPointerUp = undefined;
      }
    }
    this._hovered = null;
    this._dragged = null;
  }

  // --- Inventory -------------------------------------------------------------

  private _measureScene(): void {
    const visit = (node: Object3D): void => {
      const geo = node.geometry;
      if (geo) {
        this.stats.meshCount++;
        this.stats.triangleCount += geo.indices ? geo.indices.length / 3 : 0;
      }
      for (const child of node.children) {
        visit(child);
      }
    };
    visit(this.root);
  }

  private _scan(): void {
    const visit = (node: Object3D): void => {
      const m = PIECE_NAME.exec(node.name ?? "");
      if (m) {
        const piece: ChessPiece = {
          name: node.name ?? "",
          kind: KIND_BY_PREFIX[m[1] as string] ?? "pawn",
          color: m[2] as PieceColor,
          node,
          home: node.position.clone(),
          meshes: [],
        };
        this._collectLeafMeshes(node, piece.meshes);
        this.pieces.push(piece);
      }
      for (const child of node.children) {
        visit(child);
      }
    };
    visit(this.root);
  }

  private _collectLeafMeshes(node: Object3D, out: Object3D[]): void {
    if (node.geometry) {
      out.push(node);
    }
    for (const child of node.children) {
      this._collectLeafMeshes(child, out);
    }
  }

  /**
   * Derives the axis-aligned 8x8 lattice from the piece home positions. The white and black back
   * ranks occupy the extreme files/ranks (verified: root nodes are children of the identity
   * `glTF_Root`, board axis-aligned), so `step = (max - min) / 7` is exact -- including ranks
   * without a piece on them.
   */
  private _deriveLattice(): void {
    const xs = this.pieces.map((p) => p.home.x);
    const zs = this.pieces.map((p) => p.home.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    this.lattice.stepX = (maxX - minX) / (this.lattice.cols - 1);
    this.lattice.stepZ = (maxZ - minZ) / (this.lattice.rows - 1);
    this.lattice.originX = minX;
    this.lattice.originZ = minZ;
    this.lattice.minX = minX - this.lattice.stepX / 2;
    this.lattice.maxX = maxX + this.lattice.stepX / 2;
    this.lattice.minZ = minZ - this.lattice.stepZ / 2;
    this.lattice.maxZ = maxZ + this.lattice.stepZ / 2;
  }

  // --- Interaction -----------------------------------------------------------

  private _attach(): void {
    for (const piece of this.pieces) {
      for (const mesh of piece.meshes) {
        mesh.isPickable = true;
        mesh.onPointerEnter = (): void => this._setHover(piece, true);
        mesh.onPointerLeave = (): void => this._setHover(piece, false);
        mesh.onPointerDown = (ray: Ray, point: Vector3D): void =>
          this._startDrag(piece, ray, point);
        mesh.onPointerMove = (ray: Ray): void => this._moveDrag(piece, ray);
        mesh.onPointerUp = (): void => this._endDrag(piece);
      }
    }
  }

  private _setHover(piece: ChessPiece, on: boolean): void {
    if (this._dragged === piece) return;
    if (on) {
      this._hovered = piece;
      piece.node.scale.set(HOVER_SCALE);
    } else {
      if (this._hovered === piece) this._hovered = null;
      piece.node.scale.set(1);
    }
    this.onActivityChange?.();
  }

  private _startDrag(piece: ChessPiece, _ray: Ray, point: Vector3D): void {
    this._dragged = piece;
    this._dragPlaneY = piece.node.position.y;
    // Keep the grab offset so the piece never jumps to the ray point under the cursor.
    this._dragOffset.copyFrom(piece.node.position).sub(point);
    piece.node.scale.set(DRAG_SCALE);
    this.onActivityChange?.();
  }

  private _moveDrag(piece: ChessPiece, ray: Ray): void {
    if (this._dragged !== piece) return;
    // Horizontal drag plane through the piece's base height (same contract as DraggableBehavior
    // `mode: "ground"`); the piece is visually lifted only after the plane intersection.
    const denom = ray.direction.y;
    if (Math.abs(denom) < 1e-6) return;
    const t = (this._dragPlaneY - ray.origin.y) / denom;
    if (t < 0) return;

    const hit = ray.at(t);
    hit.add(this._dragOffset);
    this._constrain(hit);
    piece.node.position.set(hit.x, this._dragPlaneY + LIFT_Y, hit.z);
  }

  private _endDrag(piece: ChessPiece): void {
    if (this._dragged !== piece) return;
    const pos = piece.node.position;
    this._constrain(pos);
    pos.y = this._dragPlaneY;
    piece.node.scale.set(this._hovered === piece ? HOVER_SCALE : 1);
    this._dragged = null;
    this.onActivityChange?.();
  }

  /** Snap to the nearest lattice square, or clamp to the play-field bounds in free mode. */
  private _constrain(pos: { x: number; y: number; z: number }): void {
    const l = this.lattice;
    if (this.gridSnap) {
      const f = ChessSet._clamp(Math.round((pos.x - l.originX) / l.stepX), 0, l.cols - 1);
      const r = ChessSet._clamp(Math.round((pos.z - l.originZ) / l.stepZ), 0, l.rows - 1);
      pos.x = l.originX + f * l.stepX;
      pos.z = l.originZ + r * l.stepZ;
    } else {
      pos.x = ChessSet._clamp(pos.x, l.minX, l.maxX);
      pos.z = ChessSet._clamp(pos.z, l.minZ, l.maxZ);
    }
  }

  private static _clamp(v: number, min: number, max: number): number {
    return v < min ? min : v > max ? max : v;
  }
}
