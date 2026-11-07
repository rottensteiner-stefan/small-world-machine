import { describe, it, expect } from "vitest";
import {
  WebGL2GlobalUniformLayout,
  WebGL2PointLightLayout,
  WebGL2SpotLightLayout,
  WebGL2AreaLightLayout,
} from "../../src/renderers/GlobalUniformLayout.js";

/**
 * DP-6-Test-Realignment (ADR 0044, P5-Moderation): Diese Datei prüft die Clustered-Lighting-
 * Koordinaten- UND Byte-Konventionen. Der frühere Block-1 war eine hand-geschriebene std140-
 * Byte-Spiegelung und driftete vom einzigen autoritativen Layout (`GlobalUniformLayout.ts`).
 * Stattdessen wird jetzt GEGEN diese Engine-Tabelle geprüft (Real-Probe der autoren Seite):
 * die UBO ist versiegelt, die Licht-Arrays liegen kontigent & ohne Lücke an den von der Engine
 * veröffentlichten Offsets, und kein Feld ragt über `totalBytes` hinaus. Block-2 (WebGPU
 * NDC-Y-Flip) bleibt als explizit gekennzeichneter Konventions-Guard.
 */

describe("WebGL2 GlobalUniforms UBO-Byte-Konvention (Real-Probe gegen GlobalUniformLayout)", () => {
  it("pins the sealed total size and the contiguous light array placement of the engine layout", () => {
    const L = WebGL2GlobalUniformLayout;
    // Versiegelt: Die Engine-Tabelle deklariert exakt 2112 Bytes für das GlobalUniforms-UBO.
    expect(L.totalBytes).toBe(2112);

    // Die drei Licht-Arrays sind kontigent und ohne Lücken aneinander gereiht: Ende von
    // pointLights == Anfang von spotLights == Ende spotLights == Anfang areaLights ...
    const points = L.fields.pointLights as {
      offset: number;
      size: number;
      count: number;
      stride: number;
    };
    const spots = L.fields.spotLights as {
      offset: number;
      size: number;
      count: number;
      stride: number;
    };
    const areas = L.fields.areaLights as {
      offset: number;
      size: number;
      count: number;
      stride: number;
    };
    expect(spots.offset).toBe(points.offset + points.size);
    expect(areas.offset).toBe(spots.offset + spots.size);
    // Jeder Slot einer Array-Entität liegt vollständig innerhalb deklarierter Field-Bounds.
    expect(points.count * points.stride).toBe(points.size);
    expect(spots.count * spots.stride).toBe(spots.size);
    expect(areas.count * areas.stride).toBe(areas.size);
    // Slot-Größen (Byte) der drei Licht-Structs sind konsistent mit den Writer-Struktur-Tabellen.
    expect(WebGL2PointLightLayout.slotBytes).toBe(points.stride);
    expect(WebGL2SpotLightLayout.slotBytes).toBe(spots.stride);
    expect(WebGL2AreaLightLayout.slotBytes).toBe(areas.stride);
  });

  it("keeps the trailing cluster grid uniforms after the light arrays and inside the UBO", () => {
    const L = WebGL2GlobalUniformLayout;
    const areas = L.fields.areaLights as { offset: number; size: number };
    const tile = L.fields.tileSizePx as { offset: number; size: number };
    const cluster = L.fields.clusterDims as { offset: number; size: number };

    // Einzig autoritative Quelle ist die Engine-Tabelle; wir spiegeln hier keine Bytes nach,
    // sondern prüfen die INVARIANTE. `clusterDims` ist ein vec4u und std140-16-Byte-aligniert:
    // zwischen tileSizePx (vec2u, endet bei 2088) und clusterDims (16-aligniert -> 2096) sitzt
    // deshalb eine echte 8-Byte-ALIGNMENT-LÜCKE. Byte-Kontiquität wäre hier falsch; es zählt
    // Ordnung + Überlappungsfreiheit + UBO-Grenzen.
    expect(tile.offset).toBeGreaterThanOrEqual(areas.offset + areas.size); // nach den Licht-Arrays
    expect(cluster.offset).toBeGreaterThanOrEqual(tile.offset + tile.size); // danach, ohne Überlappung
    expect(cluster.offset % 16).toBe(0); // vec4u -> std140 16-Byte-Ausrichtung
    // Kein Feld ragt über totalBytes hinaus (sonst lägen die Shader-Bindings daneben).
    expect(cluster.offset + cluster.size).toBeLessThanOrEqual(L.totalBytes);
    for (const [, f] of Object.entries(L.fields)) {
      expect(f.offset).toBeGreaterThanOrEqual(0);
      expect(f.offset + f.size).toBeLessThanOrEqual(L.totalBytes);
    }
  });

  it("std140 sub-layouts start at 0 within their slots and never exceed the slot", () => {
    const check = (layout: Record<string, number>, slotBytes: number): void => {
      expect(layout["slotBytes"]).toBe(slotBytes);
      for (const [k, v] of Object.entries(layout)) {
        if (k === "slotBytes") continue;
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(slotBytes);
      }
    };
    check(WebGL2PointLightLayout as unknown as Record<string, number>, 32);
    check(WebGL2SpotLightLayout as unknown as Record<string, number>, 64);
    check(WebGL2AreaLightLayout as unknown as Record<string, number>, 96);
  });
});

describe("WebGPU Cluster-Culling-Koordinaten-Konvention (labeled convention-guard)", () => {
  it("maps NDC Y-up to the WebGPU Top-Left Origin (Y-down) framebuffer convention", () => {
    const resolutionY = 1080;
    const tileSizeY = 64;

    const lightCellRangeY = (ndcY: number, ndcRadius: number): [number, number] => {
      const centerPx = (1.0 - (ndcY * 0.5 + 0.5)) * resolutionY;
      const radiusPx = ndcRadius * 0.5 * resolutionY;
      return [(centerPx - radiusPx) / tileSizeY, (centerPx + radiusPx) / tileSizeY];
    };

    // NDC Y = +1 (Oben) muss Pixel-Y = 0 (oberste Zeile) ergeben; NDC Y = -1 -> unterste Zeile.
    const [minTop, maxTop] = lightCellRangeY(1.0, 0.1);
    expect((minTop + maxTop) / 2).toBeCloseTo(0, 1);
    const [minBottom, maxBottom] = lightCellRangeY(-1.0, 0.1);
    expect((minBottom + maxBottom) / 2).toBeCloseTo(resolutionY / tileSizeY, 1);
  });
});
