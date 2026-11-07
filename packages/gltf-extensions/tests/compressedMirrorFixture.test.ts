import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { CompressedTextureFormat } from "@small-world-machine/engine";
import { BasisWasmTranscoder } from "../src/basisu/BasisWasmTranscoder.js";
import { BasisTranscoderFormat } from "../src/basisu/basisTypes.js";
import { engineFormatForBasisFormat } from "../src/basisu/compressedFormats.js";
import {
  flippedCompressedMipChain,
  mirrorCompressedPlane,
} from "../src/basisu/compressedMirror.js";
import { flipPartition } from "../src/basisu/compressedBc7Mirror.js";
import {
  parseAstcConfig,
  readAstcWeights,
  flipPartitionSeed,
} from "../src/basisu/compressedAstcMirror.js";
import {
  ASTC_BISE_RANGE_TABLE,
  BC7_PARTITION_2_SUBSET,
  BC7_PARTITION_3_SUBSET,
} from "../src/basisu/compressedTables.js";
import { decodeBc3, decodeBc7, decodeEtc2, flipPixels } from "./helpers/miniBlockCodecs.js";

/**
 * K02 fixture contract: the compressed mirror must hold against the actual
 * block wire data the vendored Basis Universal WASM transcoder emits for a real
 * ETC1S KTX2 payload (the mirror runs BEFORE any GPU upload, so its contract is
 * defined on transcoder output, not on synthetic builders).
 *
 * Decode-level assertions run on the 4-aligned levels (0 = 40x40, 1 = 20x20)
 * where every block mirrors from a single source block. Boundary levels only
 * assert structure (length preserved, no throw). ASTC has no color oracle; its
 * wire-level weight permutation and void-extent identity are asserted instead.
 */

const vendorDir = fileURLToPath(new URL("../vendor/basis/", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixtures/ktx2/", import.meta.url));

function asArrayBuffer(source: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  ) as ArrayBuffer;
}

function loadFixtureExplicitWasm(name: string): { ktx2: Uint8Array; wasmBinary: ArrayBuffer } {
  const buffer = readFileSync(fixtureDir + name);
  const wasmBinary = asArrayBuffer(readFileSync(vendorDir + "basis_transcoder.wasm"));
  return { ktx2: new Uint8Array(buffer), wasmBinary };
}

const FLIP = [12, 13, 14, 15, 8, 9, 10, 11, 4, 5, 6, 7, 0, 1, 2, 3];

function getBits(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  let shift = 0;
  let pos = bitOffset;
  let remaining = count;
  while (remaining > 0) {
    const take = Math.min(remaining, 8 - (pos & 7));
    value |= ((bytes[pos >> 3]! >> (pos & 7)) & ((1 << take) - 1)) << shift;
    shift += take;
    pos += take;
    remaining -= take;
  }
  return value >>> 0;
}

function etcGetBits(bytes: Uint8Array, off: number, specBit: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const bp = specBit + i;
    const byte = bytes[off + (7 - (bp >> 3))]!;
    if ((byte >> (bp & 7)) & 1) value |= 1 << i;
  }
  return value >>> 0;
}

const sign3 = (v: number): number => (v >= 4 ? v - 8 : v);

function maxDeviation(a: number[][], b: number[][]): number {
  let max = 0;
  for (let t = 0; t < 16; t++) {
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(a[t]![c]! - b[t]![c]!);
      if (d > max) max = d;
    }
  }
  return max;
}

/** True when any diff channel of the block has a -4 delta (documented approximation). */
function hasDeltaNeg4(block: Uint8Array, off: number): boolean {
  for (const bit of [56, 48, 40]) {
    if (sign3(etcGetBits(block, off + 8, bit, 3)) === -4) return true;
  }
  return false;
}

describe("K02 fixture: real transcoder output through the compressed mirror", () => {
  const formats: Array<
    [string, (typeof BasisTranscoderFormat)[keyof typeof BasisTranscoderFormat]]
  > = [
    ["ETC2", BasisTranscoderFormat.ETC2],
    ["BC3", BasisTranscoderFormat.BC3],
    ["BC7", BasisTranscoderFormat.BC7],
    ["ASTC", BasisTranscoderFormat.ASTC_4x4],
  ];

  for (const [name, basisFormat] of formats) {
    const engineFormat = engineFormatForBasisFormat(basisFormat)!;
    const bytesPerBlock = engineFormat === CompressedTextureFormat.BC1_RGB ? 8 : 16;

    it(`${name}: flippedCompressedMipChain preserves every level and never throws`, async () => {
      const { ktx2, wasmBinary } = loadFixtureExplicitWasm("2d_etc1s.ktx2");
      const result = await BasisWasmTranscoder.transcode(ktx2, { wasmBinary, format: basisFormat });
      const mirrored = flippedCompressedMipChain(result.images, engineFormat);
      expect(mirrored).toHaveLength(result.images.length);
      for (let level = 0; level < result.images.length; level++) {
        const src = result.images[level]!;
        const blocksX = Math.ceil(src.width / 4);
        const blocksY = Math.ceil(src.height / 4);
        expect(mirrored[level]!.length).toBe(src.data.length);
        expect(mirrored[level]!.length).toBe(blocksX * blocksY * bytesPerBlock);
        // Double mirror stays structurally valid.
        const back = mirrorCompressedPlane(mirrored[level]!, src.width, src.height, engineFormat);
        expect(back.length).toBe(src.data.length);
      }
    });

    if (name === "ETC2" || name === "BC3" || name === "BC7") {
      it(`${name}: 4-aligned levels decode to the vertical flip of their decode`, async () => {
        const { ktx2, wasmBinary } = loadFixtureExplicitWasm("2d_etc1s.ktx2");
        const result = await BasisWasmTranscoder.transcode(ktx2, {
          wasmBinary,
          format: basisFormat,
        });
        for (const level of [0, 1]) {
          const plane = result.images[level]!;
          for (let blk = 0; blk < plane.data.length / bytesPerBlock; blk++) {
            const off = blk * bytesPerBlock;
            const b = plane.data.subarray(off, off + bytesPerBlock);
            const m = mirrorCompressedPlane(b, 4, 4, engineFormat);
            if (name === "ETC2") {
              const d = decodeEtc2(b);
              const dm = decodeEtc2(m);
              const expected = flipPixels(
                d.texels.map((row, t) => [row[0]!, row[1]!, row[2]!, d.eacIndex[t]!]),
              );
              const actual = dm.texels.map((row, t) => [
                row[0]!,
                row[1]!,
                row[2]!,
                dm.eacIndex[t]!,
              ]);
              const dev = maxDeviation(actual, expected);
              if (dev > 0) {
                // The only inexact ETC2 case is a -4 delta (one 5-bit step on the
                // new lower region); any other deviation is a mirror bug.
                expect(hasDeltaNeg4(b, 0)).toBe(true);
                expect(dev).toBeLessThanOrEqual(10);
              }
            } else if (name === "BC3") {
              expect(rgbaEqual(decodeBc3(m), flipPixels(decodeBc3(b)))).toBe(true);
            } else {
              // BC7: exact on texels whose subset the partition flip preserves.
              const mode = bc7ModeOfSubset(m);
              const subsets = bc7ModeSubsets(mode);
              if (subsets > 1) {
                const width = 1 << (mode === 0 ? 4 : 6);
                const table = subsets === 3 ? BC7_PARTITION_3_SUBSET : BC7_PARTITION_2_SUBSET;
                const part = bc7PartitionOf(b);
                const q = flipPartition(subsets, part, width);
                const dm = decodeBc7(m);
                const expected = flipPixels(decodeBc7(b));
                for (let o = 0; o < 16; o++) {
                  const src = FLIP[o]!;
                  const stable = table[q * 16 + o]! === table[part * 16 + src]!;
                  if (stable) expect(dm[o]!).toEqual(expected[o]!);
                }
              } else {
                expect(rgbaEqual(decodeBc7(m), flipPixels(decodeBc7(b)))).toBe(true);
              }
            }
          }
        }
      });
    } else {
      it(`${name}: real blocks keep their wire layout under the mirror (weight permutation, void identity)`, async () => {
        const { ktx2, wasmBinary } = loadFixtureExplicitWasm("2d_etc1s.ktx2");
        const result = await BasisWasmTranscoder.transcode(ktx2, {
          wasmBinary,
          format: basisFormat,
        });
        for (const level of [0, 1]) {
          const plane = result.images[level]!;
          for (let blk = 0; blk < plane.data.length / bytesPerBlock; blk++) {
            const off = blk * bytesPerBlock;
            const b = plane.data.subarray(off, off + bytesPerBlock);
            const m = mirrorCompressedPlane(b, 4, 4, engineFormat);
            const cfg = parseAstcConfig(m, 0);
            if (cfg.voidExtent) {
              expect(Buffer.from(m).equals(Buffer.from(b))).toBe(true);
              continue;
            }
            expect(cfg.gridWidth).toBe(4);
            expect(cfg.gridHeight).toBe(4);
            const bits = ASTC_BISE_RANGE_TABLE[cfg.weightRange]![0]!;
            const maxVal = 1 << bits;
            const rawWeight = (bytes: Uint8Array, idx: number): number =>
              getBits(bytes, 128 - (idx + 1) * bits, bits);
            const readValues = (bytes: Uint8Array): number[] =>
              readAstcWeights(bytes, 0, cfg, cfg.dualPlane ? 32 : 16);
            const inVals = readValues(b);
            const outVals = readValues(m);
            for (let g = 0; g < 16; g++) {
              // Raw wire identity: mirrored value slot (g,p) holds the source (flip(g),p).
              if (cfg.dualPlane) {
                for (let p = 0; p < 2; p++) {
                  expect(rawWeight(m, 2 * g + p)).toBe(rawWeight(b, 2 * FLIP[g]! + p));
                  expect(outVals[2 * g + p]! < maxVal).toBe(true);
                  expect(outVals[2 * g + p]).toBe(inVals[2 * FLIP[g]! + p]);
                }
              } else {
                expect(rawWeight(m, g)).toBe(rawWeight(b, FLIP[g]!));
                expect(outVals[g]! < maxVal).toBe(true);
                expect(outVals[g]).toBe(inVals[FLIP[g]!]);
              }
            }
            // Multi-partition seeds are replaced by the module's flip-closed seed
            // (pattern-level exactness is anchored by the golden partition tests).
            if (cfg.numPartitions > 1) {
              const seedIn = parseAstcConfig(b, 0).partitionSeed;
              expect(cfg.partitionSeed).toBe(flipPartitionSeed(seedIn, cfg.numPartitions));
            }
          }
        }
      });
    }
  }
});

function rgbaEqual(a: number[][], b: number[][]): boolean {
  for (let t = 0; t < 16; t++) {
    for (let c = 0; c < 4; c++) {
      if (a[t]![c] !== b[t]![c]) return false;
    }
  }
  return true;
}

/** Mode (0..7) of an input block via its mode-field leading-zero run. */
function bc7ModeOfSubset(block: Uint8Array): number {
  let bit = 0;
  for (let m = 0; m < 8; m++) {
    if (getBits(block, bit, 1) === 1) return m;
    bit++;
  }
  return -1;
}

function bc7ModeSubsets(mode: number): number {
  if (mode === 0 || mode === 2) return 3;
  if (mode === 1 || mode === 3 || mode === 7) return 2;
  return 1;
}

/** Reads the partition field of the INPUT block (modes 0/1/2/3/7). */
function bc7PartitionOf(block: Uint8Array): number {
  const mode = bc7ModeOfSubset(block);
  const headerBits = mode + 1;
  const partBits = mode === 0 ? 4 : 6;
  return getBits(block, headerBits, partBits);
}
