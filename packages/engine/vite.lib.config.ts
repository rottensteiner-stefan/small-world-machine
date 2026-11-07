import { defineConfig } from "vitest/config";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    outDir: "../../dist",
    emptyOutDir: false,
    minify: "terser",
    target: "esnext",
    lib: {
      entry: "src/index.ts",
      name: "SmallWorldMachine",
      fileName: () => "small-world-machine.js",
      formats: ["es"],
    },
    terserOptions: {
      format: {
        comments: false, // Strips out absolutely ALL comments
      },
      compress: {
        drop_console: false,
        drop_debugger: true,
        passes: 2, // Runs the optimizer twice over the code (for maximum compression)
      },
      mangle: true, // Minifies all internal variable names
    },
    rollupOptions: {
      output: {},
    },
  },
  plugins: [
    dts({
      rollupTypes: false,
      // Only the public library surface emits declarations. The engine tsconfig includes
      // tests/**/* ; some tests import ../liquid-extras/src (outside packages/engine), which
      // would otherwise pull those files into this tsc program and trip TS6059 ("not under
      // rootDir"). Tests type-correctness stays covered by the repo-wide `npm run typecheck`.
      include: ["src/**"],
    }),
  ],
});
