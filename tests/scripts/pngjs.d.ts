// Minimal typing for the slice of `pngjs` the scripts and script tests use (no @types package installed).
declare module "pngjs" {
  export class PNG {
    public static sync: { write(png: PNG): Buffer; read(buffer: Buffer): PNG };
    public data: Buffer;
    public width: number;
    public height: number;
    constructor(options?: { width: number; height: number });
  }
}
