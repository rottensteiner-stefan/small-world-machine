import globals from "globals";
import importPlugin from "eslint-plugin-import";
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default [
  // 1. Standard JavaScript & TypeScript Empfehlungen
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 2. Prettier-Konflikte deaktivieren
  prettier,

  // 3. Konfiguration für Engine-Package, Apps und Showcases (Browser-Umgebung)
  {
    files: ["packages/**/*.ts", "apps/**/*.ts", "tests/**/*.ts"],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser, // Erkennt window, document, navigator.gpu etc.
      },
    },
    rules: {
      // 1) Strikte Typisierung und Sichtbarkeit
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "explicit", overrides: { constructors: "no-public" } },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: false, allowHigherOrderFunctions: true },
      ],

      // Type-only imports are written `import type` so they vanish at runtime and cannot form import cycles
      // through the barrel files (`npm run check:cycles`).
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
          disallowTypeAnnotations: false,
        },
      ],

      // 2) Verbote & Best Practices
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const": "error",

      // 3) Naming Conventions gemäß AGENTS.md
      "@typescript-eslint/naming-convention": [
        "error",
        // Klassen, Interfaces, Enums, Type Aliases -> PascalCase
        { selector: ["class", "interface", "enum", "typeAlias"], format: ["PascalCase"] },
        // Interfaces dürfen NICHT mit I beginnen
        {
          selector: "interface",
          format: ["PascalCase"],
          custom: { regex: "^(?!I[A-Z])", match: true },
        },
        // Private Member mit führendem Unterstrich
        {
          selector: ["classProperty", "method"],
          modifiers: ["private"],
          leadingUnderscore: "require",
          format: null,
        },
      ],

      // 4) Hygiene
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // 5) ESM-Imports benötigen .js-Endung (Packages sind ausgenommen)
      "import/extensions": ["error", "ignorePackages"],

      // Combine multiple imports from the same module
      "import/no-duplicates": "error",

      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MethodDefinition[kind='constructor'] > FunctionExpression > Identifier[optional=true]:nth-child(3), MethodDefinition[kind='constructor'] > FunctionExpression > Identifier[optional=true]:nth-child(4), MethodDefinition[kind='constructor'] > FunctionExpression > Identifier[optional=true]:nth-child(5)",
          message:
            "Regel aus @AGENTS.md: Ein Konstruktor darf maximal 2 optionale Parameter haben. Nutze ab dem 3. Parameter ein 'Options Object'.",
        },
      ],
    },
  },

  // 3b. Domänen-Grenze: die Engine darf niemals aus einer App importieren (Apps -> Engine ist
  // erlaubt, die Rückrichtung nicht -- siehe ADR 0014/0015). Bewusst als reine Muster-Prüfung auf
  // dem geschriebenen Importpfad (ESLint-Core-Regel, keine eslint-plugin-import-Modulauflösung
  // nötig) -- ein Resolver würde `import/extensions` dazu bringen, jede ".js"-Endung als "falsch"
  // zu melden (moduleResolution "Bundler" mappt .js-Spezifizierer bewusst auf .ts-Dateien).
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/apps/**",
                "@small-world-machine/sample-apps",
                "**/packages/liquid-extras/**",
                "@small-world-machine/liquid-extras",
                "**/packages/vfx-extras/**",
                "@small-world-machine/vfx-extras",
                "**/packages/physics-extras/**",
                "@small-world-machine/physics-extras",
                "**/packages/geometry-extras/**",
                "@small-world-machine/geometry-extras",
                "**/packages/gltf-extensions/**",
                "@small-world-machine/gltf-extensions",
              ],
              message:
                "Die Engine (packages/engine) darf weder aus apps/ noch aus Extension-Paketen importieren. Siehe ADR 0014/0015/0025.",
            },
          ],
        },
      ],
    },
  },

  // 4. Konfiguration für deine Build-Skripte (Node.js-Umgebung)
  {
    files: ["scripts/**/*.{js,mjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node, // Erkennt process, __dirname, fs etc.
      },
    },
  },

  // 5. Globale Ignorier-Regeln (Kompilierte Dateien in Ruhe lassen)
  {
    ignores: [
      "node_modules/",
      "dist/",
      "build/",
      "docs/",
      "**/.*/**",
      "var/",
      "**/*.d.ts",
      "**/vendor/**", // Fremde vendorierte Binär-/Generierte Assets (z. B. Basis-Transcoder-Glue)
    ],
  },
];
