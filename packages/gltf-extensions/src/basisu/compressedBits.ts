/**
 * K02: low-level bit-field access for block-compressed texture mirroring.
 * Bit addressing is LSB-first over the byte array (`getBits/putBits`), which
 * matches every BC/ETC block layout we operate on. `etcGetBits/etcPutBits`
 * additionally model the ETC2 big-endian wire order (byte 0 of the 8-byte ETC
 * block holds block bits 63..56, exactly as the Basis Universal transcoder's
 * `decoder_etc_block` writes it -- ETC is the one GPU block format stored
 * MSB-first, and our mirror must preserve that exact wire order).
 */

/** Reads `count` bits (<= 32) LSB-first starting at `bitOffset`. */
export function getBits(bytes: Uint8Array, bitOffset: number, count: number): number {
  let value = 0;
  let shift = 0;
  let pos = bitOffset;
  let remaining = count;
  while (remaining > 0) {
    const take = Math.min(remaining, 8 - (pos & 7));
    const byte = bytes[pos >> 3]!;
    const chunk = (byte >> (pos & 7)) & ((1 << take) - 1);
    value |= chunk << shift;
    shift += take;
    pos += take;
    remaining -= take;
  }
  return value >>> 0;
}

/** Writes `count` bits (<= 32) LSB-first starting at `bitOffset`. */
export function putBits(bytes: Uint8Array, bitOffset: number, count: number, value: number): void {
  let pos = bitOffset;
  let remaining = count;
  let v = value >>> 0;
  while (remaining > 0) {
    const take = Math.min(remaining, 8 - (pos & 7));
    const mask = (1 << take) - 1;
    const byteIndex = pos >> 3;
    bytes[byteIndex] =
      (bytes[byteIndex]! & ~(mask << (pos & 7))) | (((v & mask) << (pos & 7)) & 0xff);
    v >>>= take;
    pos += take;
    remaining -= take;
  }
}

/** Reads `count` bits (<= 32) from an ETC block whose bit 0 = LSB of `byteOffset+7`. */
export function etcGetBits(
  bytes: Uint8Array,
  byteOffset: number,
  specBit: number,
  count: number,
): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const bp = specBit + i;
    const byte = bytes[byteOffset + 7 - (bp >> 3)]!;
    if ((byte >> (bp & 7)) & 1) value |= 1 << i;
  }
  return value >>> 0;
}

/** Writes `count` bits (<= 32) into an ETC block at `specBit`. */
export function etcPutBits(
  bytes: Uint8Array,
  byteOffset: number,
  specBit: number,
  count: number,
  value: number,
): void {
  for (let i = 0; i < count; i++) {
    const bp = specBit + i;
    const idx = byteOffset + 7 - (bp >> 3);
    const mask = 1 << (bp & 7);
    if ((value >> i) & 1) bytes[idx] = bytes[idx]! | mask;
    else bytes[idx] = bytes[idx]! & ~mask;
  }
}

/** Vertical flip of a texel slot index inside a 4x4 block (scan order, y*4+x). */
export function flipTexel(t: number): number {
  return (3 - (t >> 2)) * 4 + (t & 3);
}
