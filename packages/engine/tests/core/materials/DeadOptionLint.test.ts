import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as fs from "fs";
import * as path from "path";
import {
  BasicMaterial,
  DepthMaterial,
  WorldMaterial,
  LambertMaterial,
  PhongMaterial,
  StandardMaterial,
  GlassMaterial,
  FrostglassMaterial,
  RetroScreenMaterial,
  SkyboxMaterial,
  TerrainMaterial,
  FluidSurfaceMaterial,
  LavaMaterial,
  SlimeMaterial,
  OpenWaterMaterial,
  StylizedWaterMaterial,
  WireframeMaterial,
  SpriteMaterial,
  CustomShaderMaterial,
  Color,
  Texture,
  CubeTexture,
  Vector2D,
  Vector3D,
  CullMode,
  ShaderPropertyType,
} from "../../../src/index.js";
import { NoirWaterMaterial, OilSlickMaterial } from "../../../../liquid-extras/src/index.js";

interface PropertyInfo {
  name: string;
  isDeprecatedOrLegacy: boolean;
  file: string;
}

interface MaterialAuditResult {
  typeName: string;
  className: string;
  properties: PropertyInfo[];
  deadProperties: string[];
}

function auditMaterialDeclarations(): MaterialAuditResult[] {
  const rootDir = process.cwd();
  const engineMaterialsDir = path.join(rootDir, "packages/engine/src/core/materials");
  const liquidExtrasDir = path.join(rootDir, "packages/liquid-extras/src/materials");

  const files: string[] = [];
  function collectFiles(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        if (item !== "shaders" && item !== "importers") collectFiles(full);
      } else if (item.endsWith(".ts") && !item.endsWith(".d.ts") && item !== "index.ts") {
        files.push(full);
      }
    }
  }

  collectFiles(engineMaterialsDir);
  collectFiles(liquidExtrasDir);

  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    sourceFiles.set(file, sf);
  }

  const typeDeclarations = new Map<string, { node: ts.Node; file: string }>();
  const classDeclarations = new Map<string, { node: ts.ClassDeclaration; file: string }>();

  for (const [file, sf] of sourceFiles.entries()) {
    sf.forEachChild((node) => {
      if (ts.isInterfaceDeclaration(node)) {
        typeDeclarations.set(node.name.text, { node, file });
      } else if (ts.isTypeAliasDeclaration(node)) {
        typeDeclarations.set(node.name.text, { node, file });
      } else if (ts.isClassDeclaration(node) && node.name) {
        classDeclarations.set(node.name.text, { node, file });
      }
    });
  }

  function resolveProperties(typeName: string, visited = new Set<string>()): PropertyInfo[] {
    if (visited.has(typeName)) return [];
    visited.add(typeName);

    const decl = typeDeclarations.get(typeName);
    if (!decl) return [];

    const props: PropertyInfo[] = [];
    const { node, file } = decl;
    const sf = sourceFiles.get(file)!;

    if (ts.isInterfaceDeclaration(node)) {
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          for (const type of clause.types) {
            const extendedName = type.expression.getText(sf);
            props.push(...resolveProperties(extendedName, visited));
          }
        }
      }
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name) {
          const propName = member.name.getText(sf);
          const fullText = member.getFullText(sf);
          const isDeprecatedOrLegacy =
            fullText.includes("@deprecated") ||
            fullText.includes("@legacy") ||
            fullText.includes("legacy-tagged");
          props.push({ name: propName, isDeprecatedOrLegacy, file });
        }
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      if (ts.isTypeLiteralNode(node.type)) {
        for (const member of node.type.members) {
          if (ts.isPropertySignature(member) && member.name) {
            const propName = member.name.getText(sf);
            const fullText = member.getFullText(sf);
            const isDeprecatedOrLegacy =
              fullText.includes("@deprecated") ||
              fullText.includes("@legacy") ||
              fullText.includes("legacy-tagged");
            props.push({ name: propName, isDeprecatedOrLegacy, file });
          }
        }
      } else if (ts.isTypeReferenceNode(node.type)) {
        const refName = node.type.typeName.getText(sf);
        props.push(...resolveProperties(refName, visited));
      }
    }
    return props;
  }

  function checkClassConsumption(className: string, propName: string): boolean {
    const classInfo = classDeclarations.get(className);
    if (!classInfo) return false;

    const { node, file } = classInfo;
    const sf = sourceFiles.get(file)!;

    let consumed = false;
    function visit(child: ts.Node): void {
      if (consumed) return;
      if (ts.isIdentifier(child) && child.text === propName) {
        consumed = true;
        return;
      }
      ts.forEachChild(child, visit);
    }

    visit(node);
    if (consumed) return true;

    // Check base classes in heritage clause
    if (node.heritageClauses) {
      for (const clause of node.heritageClauses) {
        for (const type of clause.types) {
          const baseClassName = type.expression.getText(sf);
          if (checkClassConsumption(baseClassName, propName)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  const results: MaterialAuditResult[] = [];

  for (const [typeName] of typeDeclarations.entries()) {
    if (typeName.endsWith("Options")) {
      const className = typeName.replace(/Options$/, "");
      const props = resolveProperties(typeName);
      const deadProperties: string[] = [];

      // Deduplicate properties by name (derived interfaces may override properties)
      const uniqueProps = new Map<string, PropertyInfo>();
      for (const prop of props) {
        uniqueProps.set(prop.name, prop);
      }

      for (const prop of uniqueProps.values()) {
        const isConsumed = checkClassConsumption(className, prop.name);
        if (!isConsumed && !prop.isDeprecatedOrLegacy) {
          deadProperties.push(prop.name);
        }
      }

      results.push({
        typeName,
        className,
        properties: Array.from(uniqueProps.values()),
        deadProperties,
      });
    }
  }

  return results;
}

describe("DeadOptionLint (G3/G9)", () => {
  describe("Static AST Audit across all MaterialOptions", () => {
    const auditResults = auditMaterialDeclarations();

    it("should discover all expected material options interfaces in packages/engine and packages/liquid-extras", () => {
      const typeNames = auditResults.map((r) => r.typeName);
      const expected = [
        "BasicMaterialOptions",
        "LambertMaterialOptions",
        "PhongMaterialOptions",
        "StandardMaterialOptions",
        "FluidSurfaceMaterialOptions",
        "LavaMaterialOptions",
        "SlimeMaterialOptions",
        "OpenWaterMaterialOptions",
        "StylizedWaterMaterialOptions",
        "TerrainMaterialOptions",
        "WorldMaterialOptions",
        "GlassMaterialOptions",
        "FrostglassMaterialOptions",
        "RetroScreenMaterialOptions",
        "DepthMaterialOptions",
        "WireframeMaterialOptions",
        "SpriteMaterialOptions",
        "CustomShaderMaterialOptions",
        "NoirWaterMaterialOptions",
        "OilSlickMaterialOptions",
      ];

      for (const exp of expected) {
        expect(typeNames).toContain(exp);
      }
    });

    it("should verify that every property defined in any *MaterialOptions interface is consumed or tagged @deprecated/@legacy", () => {
      const deadReport: string[] = [];
      for (const res of auditResults) {
        if (res.deadProperties.length > 0) {
          deadReport.push(
            `${res.typeName} (class ${res.className}) has dead/unconsumed options: ${res.deadProperties.join(", ")}`,
          );
        }
      }

      expect(deadReport).toEqual([]);
    });

    it("should flag a synthetic dead option unless tagged with @deprecated or @legacy", () => {
      const dummySf = ts.createSourceFile(
        "dummy.ts",
        `
        export interface DummyMaterialOptions {
          activeProp?: number;
          /** @deprecated this option is dead and marked deprecated */
          deprecatedDeadProp?: number;
          unconsumedDeadProp?: number;
        }
        export class DummyMaterial {
          constructor(options: DummyMaterialOptions) {
            const x = options.activeProp;
          }
        }
        `,
        ts.ScriptTarget.Latest,
        true,
      );

      let iface: ts.InterfaceDeclaration | undefined;
      let cls: ts.ClassDeclaration | undefined;
      dummySf.forEachChild((node) => {
        if (ts.isInterfaceDeclaration(node)) iface = node;
        if (ts.isClassDeclaration(node)) cls = node;
      });

      expect(iface).toBeDefined();
      expect(cls).toBeDefined();

      const dead: string[] = [];
      for (const m of iface!.members) {
        if (ts.isPropertySignature(m) && m.name) {
          const name = m.name.getText(dummySf);
          const text = m.getFullText(dummySf);
          const isDeprecated = text.includes("@deprecated") || text.includes("@legacy");
          const isConsumed = cls!.getText(dummySf).includes(name);
          if (!isConsumed && !isDeprecated) {
            dead.push(name);
          }
        }
      }

      expect(dead).toEqual(["unconsumedDeadProp"]);
    });
  });

  class MockTexture extends Texture {
    constructor() {
      super();
    }
  }
  class MockCubeTexture extends CubeTexture {
    constructor() {
      super();
    }
  }
  const mockTex = (): Texture => new MockTexture();
  const mockCube = (): CubeTexture => new MockCubeTexture();

  // These tests prove that an option survives the constructor (stored on the instance). That an
  // option is actually CONSUMED is proven by the static AST audit above and, for the liquid family,
  // by the "reaches the manifest lanes" tests below; the other materials are assignment-only checks.
  describe("Runtime Option Storage Verification (constructor assignment)", () => {
    it("BasicMaterial consumes all options", () => {
      const col = new Color(0.2, 0.4, 0.6);
      const tex = mockTex();
      const mat = new BasicMaterial({ color: col, diffuseMap: tex });

      expect(mat.color.r).toBeCloseTo(0.2);
      expect(mat.color.g).toBeCloseTo(0.4);
      expect(mat.color.b).toBeCloseTo(0.6);
      expect(mat.diffuseMap).toBe(tex);

      const manifest = mat.getRenderManifest();
      expect(manifest.textures["u_diffuseMap"]).toBe(tex);
    });

    it("DepthMaterial consumes all options", () => {
      const tex = mockTex();
      const mat = new DepthMaterial({ diffuseMap: tex, alphaTest: 0.5 });

      expect(mat.diffuseMap).toBe(tex);
      expect(mat.alphaTest).toBe(0.5);

      const manifest = mat.getRenderManifest();
      expect(manifest.textures["u_diffuseMap"]).toBe(tex);
      expect((manifest.properties["u_extraParams"] as number[])[1]).toBe(0.5);
    });

    it("WorldMaterial consumes all options", () => {
      const col = new Color(0.1, 0.2, 0.3);
      const tex = mockTex();
      const mat = new WorldMaterial({ color: col, diffuseMap: tex });

      expect(mat.color.r).toBeCloseTo(0.1);
      expect(mat.diffuseMap).toBe(tex);

      const manifest = mat.getRenderManifest();
      expect(manifest.textures["u_diffuseMap"]).toBe(tex);
    });

    it("LambertMaterial consumes all options", () => {
      const col = new Color(0.3, 0.3, 0.3);
      const diff = mockTex();
      const norm = mockTex();
      const scale = new Vector2D(1.5, -1.5);
      const mat = new LambertMaterial({
        color: col,
        diffuseMap: diff,
        normalMap: norm,
        normalScale: scale,
      });

      expect(mat.color.r).toBeCloseTo(0.3);
      expect(mat.diffuseMap).toBe(diff);
      expect(mat.normalMap).toBe(norm);
      expect(mat.normalScale).toBe(scale);

      const manifest = mat.getRenderManifest();
      expect(manifest.textures["u_diffuseMap"]).toBe(diff);
      expect(manifest.textures["u_normalMap"]).toBe(norm);
      expect((manifest.properties["u_extraParams"] as number[])[2]).toBe(1.5);
      expect((manifest.properties["u_extraParams"] as number[])[3]).toBe(-1.5);
    });

    it("PhongMaterial consumes all options", () => {
      const col = new Color(0.5, 0.5, 0.5);
      const spec = new Color(0.8, 0.8, 0.8);
      const diff = mockTex();
      const norm = mockTex();
      const specMap = mockTex();
      const scale = new Vector2D(2.0, 2.0);

      const mat = new PhongMaterial({
        color: col,
        specularColor: spec,
        shininess: 64,
        diffuseMap: diff,
        normalMap: norm,
        normalScale: scale,
        specularMap: specMap,
        transparent: true,
        alphaTest: 0.2,
      });

      expect(mat.shininess).toBe(64);
      expect(mat.alphaTest).toBe(0.2);
      expect(mat.transparent).toBe(true);

      const manifest = mat.getRenderManifest();
      expect(manifest.properties["u_shininess"]).toBe(64);
      expect(manifest.textures["u_specularMap"]).toBe(specMap);
    });

    it("StandardMaterial consumes all options", () => {
      const diff = mockTex();
      const norm = mockTex();
      const env = mockCube();
      const refl = mockTex();

      const mat = new StandardMaterial({
        color: new Color(0.9, 0.8, 0.7),
        metallic: 0.8,
        roughness: 0.2,
        ao: 0.9,
        diffuseMap: diff,
        normalMap: norm,
        normalScale: new Vector2D(1.2, 1.2),
        metallicMap: mockTex(),
        roughnessMap: mockTex(),
        aoMap: mockTex(),
        emissiveColor: new Color(1, 0, 0),
        emissiveMap: mockTex(),
        alphaMap: mockTex(),
        envMap: env,
        reflectionMap: refl,
        reflectivity: 0.75,
        reflectionFresnelBlend: 0.6,
        emissiveIntensity: 2.5,
        transparent: true,
        alphaTest: 0.1,
        clearcoat: 0.9,
        clearcoatRoughness: 0.1,
        clearcoatMap: mockTex(),
        clearcoatRoughnessMap: mockTex(),
        clearcoatNormalMap: mockTex(),
        sheenColor: new Color(0.5, 0.5, 0.5),
        sheenRoughness: 0.3,
        sheenColorMap: mockTex(),
        sheenRoughnessMap: mockTex(),
        transmission: 0.8,
        transmissionMap: mockTex(),
        ior: 1.45,
        thickness: 0.5,
        thicknessMap: mockTex(),
        attenuationDistance: 50.0,
        attenuationColor: new Color(0.2, 0.8, 0.9),
        time: 1.5,
      });

      expect(mat.metallic).toBe(0.8);
      expect(mat.roughness).toBe(0.2);
      expect(mat.ao).toBe(0.9);
      expect(mat.clearcoat).toBe(0.9);
      expect(mat.sheenRoughness).toBe(0.3);
      expect(mat.transmission).toBe(0.8);
      expect(mat.ior).toBe(1.45);
      expect(mat.thickness).toBe(0.5);
      expect(mat.attenuationDistance).toBe(50.0);
      expect(mat.time).toBe(1.5);

      const manifest = mat.getRenderManifest();
      expect(manifest.properties["u_metallic"]).toBe(0.8);
      expect(manifest.properties["u_roughness"]).toBe(0.2);
      expect(manifest.properties["u_time"]).toBe(1.5);
    });

    it("GlassMaterial consumes all options", () => {
      const norm = mockTex();
      const mat = new GlassMaterial({
        color: new Color(0.9, 0.95, 1.0),
        metallic: 0.1,
        roughness: 0.05,
        ior: 1.52,
        thickness: 0.8,
        transmission: 0.95,
        normalMap: norm,
      });

      expect(mat.ior).toBe(1.52);
      expect(mat.thickness).toBe(0.8);
      expect(mat.transmission).toBe(0.95);
      expect(mat.normalMap).toBe(norm);

      const manifest = mat.getRenderManifest();
      const liquidParams = manifest.properties["u_liquidParams"] as number[];
      expect(liquidParams[0]).toBe(1.52);
      expect(liquidParams[1]).toBe(0.8);
      expect(liquidParams[2]).toBe(0.95);
    });

    it("FrostglassMaterial consumes all options", () => {
      const norm = mockTex();
      const center = new Vector3D(1, 2, 3);
      const mat = new FrostglassMaterial({
        color: new Color(1, 1, 1),
        metallic: 0.0,
        roughness: 0.5,
        blurRadius: 0.08,
        transmission: 0.9,
        clarityPulseCenter: center,
        clarityPulseRadius: 2.5,
        normalMap: norm,
      });

      expect(mat.blurRadius).toBe(0.08);
      expect(mat.transmission).toBe(0.9);
      expect(mat.clarityPulseRadius).toBe(2.5);

      const manifest = mat.getRenderManifest();
      const liquidParams = manifest.properties["u_liquidParams"] as number[];
      expect(liquidParams[0]).toBe(0.08);
      expect(liquidParams[1]).toBe(0.9);

      const extraParams = manifest.properties["u_extraParams"] as number[];
      expect(extraParams[0]).toBe(1);
      expect(extraParams[1]).toBe(2);
      expect(extraParams[2]).toBe(3);
      expect(extraParams[3]).toBe(2.5);
    });

    it("RetroScreenMaterial consumes all options", () => {
      const diff = mockTex();
      const mat = new RetroScreenMaterial({
        diffuseMap: diff,
        mode: "film19th",
        intensity: 0.85,
        speed: 1.2,
        param1: 0.5,
        param2: 10.0,
        param3: 0.7,
        param4: 0.9,
      });

      expect(mat.diffuseMap).toBe(diff);
      expect(mat.mode).toBe("film19th");
      expect(mat.intensity).toBe(0.85);
      expect(mat.speed).toBe(1.2);
      expect(mat.param1).toBe(0.5);
      expect(mat.param2).toBe(10.0);
      expect(mat.param3).toBe(0.7);
      expect(mat.param4).toBe(0.9);

      const manifest = mat.getRenderManifest();
      // E9-A: control lane u_matParam0 = [intensity, time, speed, modeFlag]; params lane
      // u_matParam1 = [param1..4] (was u_extraParams/u_liquidParams).
      const ctl = manifest.properties["u_matParam0"] as number[];
      expect(ctl[0]).toBe(0.85);
      expect(ctl[2]).toBe(1.2);
      expect(ctl[3]).toBe(1.0); // film19th mode flag
    });

    it("SkyboxMaterial consumes all options", () => {
      const cube = mockCube();
      const mat = new SkyboxMaterial({
        color: new Color(0.8, 0.8, 0.8),
        cubeMap: cube,
      });

      expect(mat.cubeMap).toBe(cube);

      const manifest = mat.getRenderManifest();
      expect(manifest.textures["u_skybox"]).toBe(cube);
    });

    it("TerrainMaterial consumes all options", () => {
      const sand = mockTex();
      const grass = mockTex();
      const rock = mockTex();
      const snow = mockTex();

      const mat = new TerrainMaterial({
        color: new Color(1, 1, 1),
        shininess: 15,
        sandMap: sand,
        grassMap: grass,
        rockMap: rock,
        snowMap: snow,
        texRepeat: [30, 30],
        thresholds: [3.0, 18.0, 30.0, 2.5],
      });

      expect(mat.shininess).toBe(15);
      expect(mat.sandMap).toBe(sand);
      expect(mat.texRepeat).toEqual([30, 30]);

      const manifest = mat.getRenderManifest();
      expect(manifest.textures["u_sandMap"]).toBe(sand);
      expect(manifest.textures["u_grassMap"]).toBe(grass);
      expect(manifest.textures["u_rockMap"]).toBe(rock);
      expect(manifest.textures["u_snowMap"]).toBe(snow);
    });

    it("FluidSurfaceMaterial, LavaMaterial, SlimeMaterial consume options", () => {
      const noise = mockTex();
      const norm = mockTex();

      const fluid = new FluidSurfaceMaterial({
        color: new Color(0.1, 0.5, 0.9),
        edgeColor: new Color(1, 1, 1),
        flowSpeed: 1.5,
        distortion: 2.2,
        viscosity: 8.0,
        waveAmplitude: 0.1,
        rimStrength: 0.4,
        specularStrength: 0.3,
        specularPower: 60.0,
        normalStrength: 1.2,
        absorption: 3.0,
        shade: 0.7,
        emissiveMask: 0.5,
        emissivePulse: 0.2,
        emissivePulseSpeed: 3.0,
        transitionSoftness: 0.25,
        noiseMap: noise,
        normalMap: norm,
        emissiveColor: new Color(1, 0.5, 0),
        emissiveStrength: 1.4,
      });

      expect(fluid.viscosity).toBe(8.0);
      expect(fluid.waveAmplitude).toBe(0.1);
      expect(fluid.noiseMap).toBe(noise);

      const lava = new LavaMaterial({
        flowSpeed: 0.4,
        emissiveStrength: 2.0,
      });
      expect(lava.flowSpeed).toBe(0.4);
      expect(lava.emissiveStrength).toBe(2.0);

      const slime = new SlimeMaterial({
        absorption: 8.0,
        rimStrength: 0.7,
      });
      expect(slime.absorption).toBe(8.0);
      expect(slime.rimStrength).toBe(0.7);
    });

    it("OpenWaterMaterial and StylizedWaterMaterial consume options", () => {
      const openWater = new OpenWaterMaterial({
        waterColor: new Color(0.1, 0.4, 0.7),
        deepWaterColor: new Color(0.01, 0.05, 0.2),
        edgeColor: new Color(0.9, 0.95, 1.0),
        edgeSoftness: 1.2,
        speed: 1.1,
        wave1: [1.0, 0.5, 0.1, 8.0],
        wave2: [0.2, 0.7, 0.12, 5.0],
        wave3: [-0.3, 0.5, 0.04, 2.0],
        refractionStrength: 0.04,
        waterAbsorption: [0.35, 0.08, 0.03],
        foamColor: new Color(1, 1, 1),
        foamDistance: 1.5,
        foamCutoff: 0.55,
        foamNoiseScale: 4.0,
        foamNoiseSpeed: 0.7,
      });

      expect(openWater.refractionStrength).toBe(0.04);
      expect(openWater.foamDistance).toBe(1.5);
      expect(openWater.waterAbsorption).toEqual([0.35, 0.08, 0.03]);

      const stylizedWater = new StylizedWaterMaterial({
        shallowWaterColor: new Color(0.1, 0.6, 0.8),
        causticStrength: 0.75,
        specularStrength: 0.5,
        rampSoftness: 0.8,
        washAmount: 0.3,
        lineDensity: 2.0,
        lineWidth: 0.6,
        foamSoftness: 0.1,
        skyTint: 0.4,
        glitterStrength: 0.8,
        styleId: 2,
        style: "sparkle",
      });

      expect(stylizedWater.causticStrength).toBe(0.75);
      expect(stylizedWater.glitterStrength).toBe(0.8);
      expect(stylizedWater.styleId).toBe(2);

      const manifest = stylizedWater.getRenderManifest();
      expect(manifest.properties["u_styleA"]).toBeDefined();
      expect(manifest.properties["u_styleB"]).toBeDefined();
    });

    it("OpenWater options reach the manifest lanes the shader reads", () => {
      const mat = new OpenWaterMaterial({
        waterColor: new Color(0.1, 0.4, 0.7),
        deepWaterColor: new Color(0.01, 0.05, 0.2),
        edgeColor: new Color(0.9, 0.95, 1.0),
        edgeSoftness: 1.2,
        speed: 1.1,
        wave1: [1.0, 0.5, 0.1, 8.0],
        wave2: [0.2, 0.7, 0.12, 5.0],
        wave3: [-0.3, 0.5, 0.04, 2.0],
        refractionStrength: 0.04,
        waterAbsorption: [0.35, 0.08, 0.03],
        foamColor: new Color(0.9, 0.8, 0.7),
        foamDistance: 1.5,
        foamCutoff: 0.55,
        foamNoiseScale: 4.0,
        foamNoiseSpeed: 0.7,
        poolHalfExtent: 3.0,
      });
      const props = mat.getRenderManifest().properties as Record<string, number[] | number>;
      const lane = (name: string): number[] => props[name] as number[];

      expect(lane("u_matParam3")).toEqual([1.0, 0.5, 0.1, 8.0]);
      expect(lane("u_matParam4")).toEqual([0.2, 0.7, 0.12, 5.0]);
      expect(lane("u_matParam5")).toEqual([-0.3, 0.5, 0.04, 2.0]);
      expect(props["u_reflectivity"]).toBe(1.1);
      expect(lane("u_matParam6")[3]).toBe(1.2);
      expect(lane("u_matParam0")).toEqual([0.35, 0.08, 0.03, 0.04]);
      expect(lane("u_matParam1")[0]).toBeCloseTo(0.9, 6);
      expect(lane("u_matParam1")[3]).toBe(1.5);
      expect(lane("u_matParam2")).toEqual([0.55, 4.0, 0.7, 3.0]);
    });

    it("Stylized options reach the style lanes the shader reads", () => {
      const mat = new StylizedWaterMaterial({
        style: "sparkle",
        rampSoftness: 0.8,
        washAmount: 0.3,
        lineDensity: 2.0,
        lineWidth: 0.6,
        foamSoftness: 0.1,
        skyTint: 0.4,
        glitterStrength: 0.8,
        styleId: 2,
      });
      const props = mat.getRenderManifest().properties as Record<string, number[]>;
      expect(props["u_styleA"]).toEqual([0.8, 0.3, 2.0, 0.6]);
      expect(props["u_styleB"]).toEqual([0.1, 0.4, 0.8, 2]);
    });

    it("WireframeMaterial and SpriteMaterial consume options object", () => {
      const wire = new WireframeMaterial({
        color: new Color(0.1, 0.8, 0.3),
        wireframeMode: "triangles",
      });
      expect(wire.color.r).toBeCloseTo(0.1);
      expect(wire.wireframeMode).toBe("triangles");

      const colorOverload = new WireframeMaterial(new Color(0.2, 0.3, 0.4), "triangles");
      expect(colorOverload.wireframeMode).toBe("triangles");
      expect(colorOverload.color.g).toBeCloseTo(0.3);
      expect(new WireframeMaterial({}).wireframeMode).toBe("structural");
      expect(() => new WireframeMaterial(null as unknown as Color)).toThrow(TypeError);

      const tex = mockTex();
      const sprite = new SpriteMaterial({
        texture: tex,
        color: new Color(0.9, 0.2, 0.4),
        transparent: false,
      });
      expect(sprite.texture).toBe(tex);
      expect(sprite.color.r).toBeCloseTo(0.9);
      expect(sprite.transparent).toBe(false);
    });

    it("CustomShaderMaterial consumes all options", () => {
      const csm = new CustomShaderMaterial({
        sources: { wgsl: "fn test() {}" },
        layout: { uniforms: { u_custom: { type: ShaderPropertyType.FLOAT } }, textures: {} },
        properties: { u_custom: 42.0 },
        textures: {},
        transparent: true,
        cullMode: CullMode.NONE,
        depthWrite: false,
        depthTest: true,
      });

      expect(csm.transparent).toBe(true);
      expect(csm.cullMode).toBe(CullMode.NONE);
      expect(csm.depthWrite).toBe(false);
      expect(csm.depthTest).toBe(true);
      expect(csm.properties["u_custom"]).toBe(42.0);
    });

    it("NoirWaterMaterial and OilSlickMaterial in liquid-extras consume extended options", () => {
      const noir = new NoirWaterMaterial({
        posterizeSteps: 6,
        shallowWaterColor: new Color(0.9, 0.9, 0.9),
      });
      expect(noir.posterizeSteps).toBe(6);

      const noirManifest = noir.getRenderManifest();
      expect((noirManifest.properties["u_styleA"] as number[])[3]).toBe(6);

      const oil = new OilSlickMaterial({
        iridescenceStrength: 0.85,
      });
      expect(oil.iridescenceStrength).toBe(0.85);

      const oilManifest = oil.getRenderManifest();
      expect((oilManifest.properties["u_styleA"] as number[])[3]).toBe(0.85);
    });
  });
});
