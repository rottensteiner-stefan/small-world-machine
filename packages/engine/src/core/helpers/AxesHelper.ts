import { Object3D } from "../Object3D.js";
import { Color } from "../colors/index.js";
import { BasicMaterial, SpriteMaterial } from "../materials/index.js";
import { Cylinder, Cone } from "../../geometry/index.js";
import { Sprite } from "../sprites/Sprite.js";
import { TextTexture } from "../text/index.js";
import { TextAlign } from "../../enums/index.js";

/**
 * Configuration options for the AxesHelper coordinate cross.
 */
export interface AxesHelperOptions {
  /** Total length of each axis. Defaults to 1.0. */
  size?: number;
  /** Radius of the axis cylinder shaft. Defaults to `size * 0.02`. */
  shaftRadius?: number;
  /** Length of the cone arrow tip. Defaults to `size * 0.2`. */
  headLength?: number;
  /** Base radius of the cone arrow tip. Defaults to `size * 0.05`. */
  headRadius?: number;
  /** Whether to show text labels ("X", "Y", "Z") at the axis tips. Defaults to true. */
  showLabels?: boolean;
  /** Neon color for the X-axis (+X, right). Defaults to `#ff1744`. */
  xColor?: Color;
  /** Neon color for the Y-axis (+Y, up). Defaults to `#00e676`. */
  yColor?: Color;
  /** Neon color for the Z-axis (+Z, forward/backward). Defaults to `#00e5ff`. */
  zColor?: Color;
  /** Billboard scale for the text labels. Defaults to `size * 0.25`. */
  labelScale?: number;
}

/**
 * 3D Coordinate cross (AxesHelper) visualizing the X, Y, and Z axes.
 *
 * Color scheme (neon / high-contrast):
 * - X-Axis: Neon Red (+X) with "X" label
 * - Y-Axis: Neon Green (+Y) with "Y" label
 * - Z-Axis: Neon Blue (+Z) with "Z" label
 *
 * Each axis features a cylindrical shaft, a conical arrow tip pointing in the positive direction,
 * and an optional billboarded text label at the tip.
 */
export class AxesHelper extends Object3D {
  /** The root node for the X axis components. */
  public readonly xAxis: Object3D;
  /** The root node for the Y axis components. */
  public readonly yAxis: Object3D;
  /** The root node for the Z axis components. */
  public readonly zAxis: Object3D;

  /** The label sprite for X axis, if enabled. */
  public readonly xLabel?: Sprite;
  /** The label sprite for Y axis, if enabled. */
  public readonly yLabel?: Sprite;
  /** The label sprite for Z axis, if enabled. */
  public readonly zLabel?: Sprite;

  /** Total size of the helper. */
  public readonly size: number;

  constructor(options: AxesHelperOptions = {}) {
    super("AxesHelper");

    const size = options.size ?? 1.0;
    this.size = size;

    const shaftRadius = options.shaftRadius ?? Math.max(0.005, size * 0.02);
    const headLength = options.headLength ?? Math.max(0.04, size * 0.2);
    const headRadius = options.headRadius ?? Math.max(0.015, size * 0.05);
    const shaftLength = Math.max(0.001, size - headLength);
    const showLabels = options.showLabels ?? true;
    const labelScale = options.labelScale ?? size * 0.25;

    // Neon high-visibility colors
    const xColor = options.xColor ?? new Color(1.0, 0.09, 0.27); // Neon Red #ff1744
    const yColor = options.yColor ?? new Color(0.0, 0.9, 0.46); // Neon Green #00e676
    const zColor = options.zColor ?? new Color(0.0, 0.9, 1.0); // Neon Blue #00e5ff

    // Materials (BasicMaterial ensures unlit neon radiance in any scene)
    const xMat = new BasicMaterial({ color: xColor });
    const yMat = new BasicMaterial({ color: yColor });
    const zMat = new BasicMaterial({ color: zColor });

    // Shared geometries
    const shaftGeo = new Cylinder({
      radiusTop: shaftRadius,
      radiusBottom: shaftRadius,
      height: shaftLength,
      radialSegments: 16,
    }).getGeometryData();

    const headGeo = new Cone({
      radius: headRadius,
      height: headLength,
      radialSegments: 16,
    }).getGeometryData();

    // --- Y Axis (+Y: Up, Green) ---
    this.yAxis = new Object3D("Axis_Y");

    const yShaft = new Object3D("Shaft_Y");
    yShaft.geometry = shaftGeo;
    yShaft.material = yMat;
    yShaft.position.set(0, shaftLength / 2, 0);
    this.yAxis.add(yShaft);

    const yHead = new Object3D("Head_Y");
    yHead.geometry = headGeo;
    yHead.material = yMat;
    yHead.position.set(0, shaftLength + headLength / 2, 0);
    this.yAxis.add(yHead);

    if (showLabels) {
      this.yLabel = this._createLabel("Y", "#00e676", labelScale);
      this.yLabel.position.set(0, size + labelScale * 0.6, 0);
      this.yAxis.add(this.yLabel);
    }
    this.add(this.yAxis);

    // --- X Axis (+X: Right, Red) ---
    // Rotate by -90° around Z so +Y becomes +X
    const xRotZ = -Math.PI / 2;
    this.xAxis = new Object3D("Axis_X");

    const xShaft = new Object3D("Shaft_X");
    xShaft.geometry = shaftGeo;
    xShaft.material = xMat;
    xShaft.position.set(shaftLength / 2, 0, 0);
    xShaft.rotation.set(0, 0, xRotZ);
    this.xAxis.add(xShaft);

    const xHead = new Object3D("Head_X");
    xHead.geometry = headGeo;
    xHead.material = xMat;
    xHead.position.set(shaftLength + headLength / 2, 0, 0);
    xHead.rotation.set(0, 0, xRotZ);
    this.xAxis.add(xHead);

    if (showLabels) {
      this.xLabel = this._createLabel("X", "#ff1744", labelScale);
      this.xLabel.position.set(size + labelScale * 0.6, 0, 0);
      this.xAxis.add(this.xLabel);
    }
    this.add(this.xAxis);

    // --- Z Axis (+Z: Forward/Backward, Blue) ---
    // Rotate by +90° around X so +Y becomes +Z
    const zRotX = Math.PI / 2;
    this.zAxis = new Object3D("Axis_Z");

    const zShaft = new Object3D("Shaft_Z");
    zShaft.geometry = shaftGeo;
    zShaft.material = zMat;
    zShaft.position.set(0, 0, shaftLength / 2);
    zShaft.rotation.set(zRotX, 0, 0);
    this.zAxis.add(zShaft);

    const zHead = new Object3D("Head_Z");
    zHead.geometry = headGeo;
    zHead.material = zMat;
    zHead.position.set(0, 0, shaftLength + headLength / 2);
    zHead.rotation.set(zRotX, 0, 0);
    this.zAxis.add(zHead);

    if (showLabels) {
      this.zLabel = this._createLabel("Z", "#00e5ff", labelScale);
      this.zLabel.position.set(0, 0, size + labelScale * 0.6);
      this.zAxis.add(this.zLabel);
    }
    this.add(this.zAxis);
  }

  /**
   * Generates a billboarded Sprite label with the specified letter and color.
   */
  private _createLabel(text: string, colorHex: string, scale: number): Sprite {
    const textTexture = new TextTexture({
      text,
      fontSize: 64,
      fontWeight: 800,
      fontFamily: "monospace, sans-serif",
      color: colorHex,
      align: TextAlign.CENTER,
      background: "transparent",
      padding: 12,
      outline: { color: "#000000", width: 8 },
      shadow: { color: colorHex, blur: 12, offsetX: 0, offsetY: 0 },
    });

    const spriteMat = new SpriteMaterial({
      texture: textTexture.texture,
      transparent: true,
    });

    const sprite = new Sprite(spriteMat, `Label_${text}`);
    sprite.scale.set(scale, scale, 1);
    return sprite;
  }
}
