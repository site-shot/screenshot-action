// Builds PNG files for the tests: well-formed ones, and damaged ones derived
// from them one defect at a time. CRCs are always correct unless a test breaks
// them on purpose, so each damaged file fails for the one reason it is named
// after. The well-formed results are cross-checked by the encoder-made files
// in test/fixtures/, which this code did not produce.
import { readFileSync } from "node:fs";
import { constants, crc32, deflateRawSync, deflateSync } from "node:zlib";

export const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface Chunk {
  type: string;
  data: Buffer;
}

export function fixture(name: string): Buffer {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
}

/** One encoded chunk: length, type, data and the CRC of type and data. */
export function encodeChunk({ type, data }: Chunk): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

export function pngOf(chunks: Chunk[]): Buffer {
  return Buffer.concat([SIGNATURE, ...chunks.map(encodeChunk)]);
}

/** The chunks of a well-formed PNG. For fixtures only: it trusts its input. */
export function chunksOf(png: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  for (let at = SIGNATURE.length; at < png.length; ) {
    const length = png.readUInt32BE(at);
    chunks.push({
      type: png.toString("latin1", at + 4, at + 8),
      data: Buffer.from(png.subarray(at + 8, at + 8 + length)),
    });
    at += 12 + length;
  }
  return chunks;
}

export interface Header {
  width: number;
  height: number;
  bitDepth?: number;
  colorType?: number;
  compression?: number;
  filter?: number;
  interlace?: number;
}

export function ihdr({
  width,
  height,
  bitDepth = 8,
  colorType = 0,
  compression = 0,
  filter = 0,
  interlace = 0,
}: Header): Chunk {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data.writeUInt8(bitDepth, 8);
  data.writeUInt8(colorType, 9);
  data.writeUInt8(compression, 10);
  data.writeUInt8(filter, 11);
  data.writeUInt8(interlace, 12);
  return { type: "IHDR", data };
}

export function idat(raw: Buffer): Chunk {
  return { type: "IDAT", data: deflateSync(raw) };
}

export const IEND: Chunk = { type: "IEND", data: Buffer.alloc(0) };

/**
 * 8-bit grayscale scanlines: every row is filter byte 0 and then one byte per
 * pixel, so the size is easy to check by hand: height * (1 + width).
 */
export function grayRows(width: number, height: number): Buffer {
  const row = Buffer.alloc(1 + width, 0x80);
  row[0] = 0;
  return Buffer.concat(Array.from({ length: height }, () => row));
}

/** A complete, valid 8-bit grayscale PNG. */
export function grayPng(width: number, height: number): Buffer {
  return pngOf([ihdr({ width, height }), idat(grayRows(width, height)), IEND]);
}

/**
 * A zlib stream that inflates to `mebibytes` MiB of zeros while being about a
 * thousandth of that size: a fully flushed deflate block of 1 MiB of zeros,
 * repeated, then an empty final block (03 00) and the Adler-32 of the whole,
 * which for n zero bytes is (n mod 65521) << 16 | 1.
 */
export function zeroBomb(mebibytes: number): Buffer {
  const block = deflateRawSync(Buffer.alloc(1 << 20), { finishFlush: constants.Z_FULL_FLUSH });
  const adler = Buffer.alloc(4);
  adler.writeUInt32BE((((mebibytes * 2 ** 20) % 65521) * 0x10000 + 1) >>> 0);
  return Buffer.concat([Buffer.from([0x78, 0x9c]), ...Array<Buffer>(mebibytes).fill(block), Buffer.from([0x03, 0x00]), adler]);
}
