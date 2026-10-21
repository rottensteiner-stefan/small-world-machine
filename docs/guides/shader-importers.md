# Shader Importers

The Small World Machine includes a powerful `CustomShaderMaterial` system that lets you run external shader code. To make copy-pasting code from popular shader platforms easier, the engine ships built-in **shader importers**.

These importers automatically translate external shader syntax into the engine's internal formats and layout structures.

## Built-In Importers

The engine ships with three built-in importers:

1. **`ShadertoyImporter`**: Parses Shadertoy code (GLSL300 and GLSL100), translates `mainImage`, and resolves built-in uniforms such as `iTime` and `iResolution`.
2. **`GLSLSandboxImporter`**: Parses GLSLSandbox code, translates legacy `gl_FragColor` assignments, and maps `time`/`mouse` uniforms.
3. **`ComputeToysImporter`**: Parses Compute.toys code (WGSL).

### The ComputeToysImporter Heuristic

Important to know: `ComputeToysImporter` works with a **"best-effort" regex heuristic**.

Compute.toys uses *compute shaders*, while Small World Machine's `CustomShaderMaterial` runs in a *fragment shader* pipeline. To bridge this gap, the built-in importer uses regular expressions to find signatures like `textureStore(screen, id, color)` and dynamically rewrite them into fragment-friendly `return color;` statements.

**Limitation:** Since this is a regex-based translation rather than a full abstract syntax tree (AST) parser, it is inherently fragile. If a WGSL shader uses complex nested function calls, wraps `textureStore` across multiple lines, or relies heavily on compute-specific memory features, the heuristic fails and the shader does not compile.

Building a full WGSL AST transpiler is out of scope for the Small World Machine core engine. However, the engine's architecture lets the community swap this out easily!

## Writing Your Own Importer

The shader importer system is fully decoupled via the `ShaderImporter` interface. The engine doesn't care whether an importer comes from the core library or from your own project.

If the built-in `ComputeToysImporter` is too limited for your needs, you can easily build your own, more robust WGSL parser and use that instead.

### 1. Implement the Interface

Create a class that implements the `ShaderImporter` interface. Your class must provide a `parse(sourceCode: string)` method that returns a `CustomShaderMaterialOptions` object.

```typescript
import { 
  ShaderImporter, 
  CustomShaderMaterialOptions, 
  ShaderPropertyType 
} from "@small-world-machine/engine";

export class AdvancedWGSLParser implements ShaderImporter {
  public parse(sourceCode: string): CustomShaderMaterialOptions {
    // 1. Write your advanced parsing logic (e.g. using an AST parser)
    const transpiledCode = myAdvancedAstParser(sourceCode);
    
    // 2. Return the structured options the engine needs
    return {
      sources: {
        wgsl: transpiledCode, // Provide the transpiled WGSL code
      },
      layout: {
        uniforms: {
          time: { type: ShaderPropertyType.FLOAT },
          resolution: { type: ShaderPropertyType.VEC2 },
          // Define any further uniforms your transpiled shader needs
        },
        uniformLayout: ["time", "resolution"]
      },
      properties: {
        time: 0,
        resolution: [800, 600]
      }
    };
  }
}
```

### 2. Inject It Into the Material

Since the engine relies on dependency injection for importers, you simply pass an instance of your own importer directly in when creating the `CustomShaderMaterial`.

```typescript
import { CustomShaderMaterial } from "@small-world-machine/engine";
import { AdvancedWGSLParser } from "./AdvancedWGSLParser";

// The raw WGSL code from compute.toys or another source
const RAW_WGSL_CODE = `...`;

// Inject your own parser!
const material = new CustomShaderMaterial(
  new AdvancedWGSLParser().parse(RAW_WGSL_CODE)
);
```

This architecture lets the community develop, share, and use sophisticated shader compilers as standalone packages, without needing pull requests or changes to the Small World Machine core engine.
