// The package ships types only for its main entry; `scripts/lint-wgsl.ts` imports the ESM bundle.
declare module "wgsl_reflect/wgsl_reflect.module.js" {
  export * from "wgsl_reflect";
}
