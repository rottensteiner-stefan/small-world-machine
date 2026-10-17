/**
 * Headless image-codec seam (Finding F5 / D2 boundary rules).
 *
 * Everything under `core/` moves images around as raw RGBA buffers (`RgbaImage`),
 * never as DOM image objects. Turning image bytes into those buffers -- and encoding
 * them back to PNG -- is the job of a `RasterIO` adapter, so the pure pipeline stays
 * decoupled from the actual codec (browser decode never equals pngjs decode: color
 * spaces, gamma and premultiplication differ). The interface itself carries zero DOM
 * types.
 */

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface RasterIO {
  /** Decodes PNG image bytes into an RGBA pixel buffer. */
  decode(bytes: Uint8Array): Promise<RgbaImage>;
  /** Encodes an RGBA pixel buffer as PNG bytes. */
  encodePng(image: RgbaImage): Promise<Uint8Array>;
}

/**
 * Node.js adapter built on `pngjs` (currently a root devDependency only; promoting
 * it to a production dependency of `@small-world-machine/tools` is a later packaging
 * fix, Finding F4). `pngjs` is CommonJS and ships no type declarations, so the module
 * is loaded through a dynamic `import` whose result is cast to a minimal structural
 * shape. The dynamic import is key for the browser: it executes lazily, so browser
 * bundles never touch a Node builtin at module scope.
 */
interface PngJsPng {
  width: number;
  height: number;
  data: Uint8Array;
}

interface PngJsSyncApi {
  sync: {
    read(buffer: Uint8Array): PngJsPng;
    write(
      png: { width: number; height: number; data: Uint8Array },
      options?: { inputHasAlpha?: boolean },
    ): Uint8Array;
  };
}

interface PngJsNamespace {
  PNG: PngJsSyncApi;
}

interface PngJsModuleShape {
  default?: PngJsNamespace;
  PNG?: PngJsNamespace["PNG"];
}

async function loadPngJs(): Promise<PngJsSyncApi["sync"]> {
  const raw = (await import("pngjs")) as unknown as PngJsModuleShape;
  const namespace = raw.default ?? raw;
  // The module is `{ default: { PNG } }` under ESM interop and `{ PNG }` under CJS;
  // `PNG` is the pngjs class whose synchronous codec lives on `PNG.sync`.
  const png = namespace === undefined ? undefined : namespace.PNG;
  if (png === undefined || png.sync === undefined) {
    throw new Error("NodePngRasterIO: pngjs did not expose its sync codec");
  }
  return png.sync;
}

export class NodePngRasterIO implements RasterIO {
  public async decode(bytes: Uint8Array): Promise<RgbaImage> {
    const png = await loadPngJs();
    const decoded = png.read(Buffer.from(bytes));
    if (
      !Number.isInteger(decoded.width) ||
      !Number.isInteger(decoded.height) ||
      decoded.width <= 0 ||
      decoded.height <= 0
    ) {
      throw new Error("NodePngRasterIO: decoded image has invalid dimensions");
    }
    return {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8ClampedArray(decoded.data),
    };
  }

  public async encodePng(image: RgbaImage): Promise<Uint8Array> {
    const png = await loadPngJs();
    const buffer = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength);
    const encoded = png.write(
      { width: image.width, height: image.height, data: buffer },
      { inputHasAlpha: true },
    );
    return new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  }
}
