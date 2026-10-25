import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync, inflateSync } from "node:zlib";

import { checkPng } from "../src/png.ts";
import {
  IEND,
  SIGNATURE,
  chunksOf,
  encodeChunk,
  fixture,
  grayPng,
  grayRows,
  idat,
  ihdr,
  pngOf,
  type Chunk,
  type Header,
  zeroBomb,
} from "./support/png.ts";

// The API's largest viewport: width 100-8000, height 100-20000.
const LIMITS = { maxWidth: 8000, maxHeight: 20000 };

function problem(name: string) {
  return { name: "PngError", problem: name };
}

function withIdat(chunks: Chunk[], change: (raw: Buffer) => Buffer): Chunk[] {
  return chunks.map((chunk) =>
    chunk.type === "IDAT" ? { type: "IDAT", data: deflateSync(change(inflateSync(chunk.data))) } : chunk,
  );
}

test("accepts PNG files made by other encoders and returns their dimensions", () => {
  // Dimensions as reported by `magick identify`, not by the code under test.
  const cases: [string, number, number][] = [
    ["viewport-1024x768.png", 1024, 768], // ImageMagick: truecolor 8-bit, in three IDAT chunks
    ["rgba-interlaced.png", 13, 7], // ImageMagick: RGBA 8-bit, Adam7 interlaced
    ["gray16.png", 5, 3], // ImageMagick: grayscale 16-bit
    ["palette.png", 9, 4], // ImageMagick: 2-bit palette with PLTE
  ];
  for (const [name, width, height] of cases) {
    assert.deepEqual(checkPng(fixture(name), LIMITS), { width, height }, name);
  }
});

test("accepts image data split over consecutive IDAT chunks at any byte", () => {
  // ImageMagick wrote this one as IDAT chunks of 32768, 32768 and 18202 bytes.
  const chunks = chunksOf(fixture("viewport-1024x768.png"));
  assert.deepEqual(
    chunks.map((chunk) => `${chunk.type} ${chunk.data.length}`),
    ["IHDR 13", "IDAT 32768", "IDAT 32768", "IDAT 18202", "IEND 0"],
  );
  const data = Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  const parts = [data.subarray(0, 1), data.subarray(1, 10), data.subarray(10, 50_001), data.subarray(50_001)];
  const resplit = pngOf([chunks[0] as Chunk, ...parts.map((part) => ({ type: "IDAT", data: part })), IEND]);
  assert.deepEqual(checkPng(resplit, LIMITS), { width: 1024, height: 768 });
  assert.deepEqual(checkPng(pngOf([chunks[0] as Chunk, { type: "IDAT", data }, IEND]), LIMITS), { width: 1024, height: 768 });
});

test("accepts ancillary chunks, known or not, before and after the image data", () => {
  const [header, data, end] = chunksOf(fixture("gray16.png")) as [Chunk, Chunk, Chunk];
  const text = { type: "tEXt", data: Buffer.from("Comment\0written by a test") };
  const privateChunk = { type: "prVt", data: Buffer.from([1, 2, 3]) };
  assert.deepEqual(checkPng(pngOf([header, text, data, privateChunk, end]), LIMITS), { width: 5, height: 3 });
});

test("accepts the smallest image and the largest dimensions the API can return", () => {
  assert.deepEqual(checkPng(grayPng(1, 1), LIMITS), { width: 1, height: 1 });
  assert.deepEqual(checkPng(grayPng(8000, 1), LIMITS), { width: 8000, height: 1 });
  assert.deepEqual(checkPng(grayPng(1, 20000), LIMITS), { width: 1, height: 20000 });
});

test("refuses data that is not a PNG at all", () => {
  const cases: Record<string, Buffer> = {
    empty: Buffer.alloc(0),
    "a JPEG": fixture("photo.jpg"),
    "an HTML error page": Buffer.from("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>"),
    "a JSON error": Buffer.from('{"error":"Screenshot capture failed"}'),
    "a PNG whose line endings were translated": Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a]),
      fixture("gray16.png").subarray(8),
    ]),
    "seven bytes of the signature": SIGNATURE.subarray(0, 7),
  };
  for (const [name, data] of Object.entries(cases)) {
    assert.throws(() => checkPng(data, LIMITS), problem("not-png"), name);
  }
});

test("refuses a PNG that is cut short anywhere", () => {
  // gray16.png is 76 bytes: signature 0-7, IHDR 8-32, IDAT 33-63, IEND 64-75.
  const png = fixture("gray16.png");
  assert.equal(png.length, 76);
  for (const length of [8, 20, 32, 33, 40, 63, 64, 70, 75]) {
    assert.throws(() => checkPng(png.subarray(0, length), LIMITS), problem("truncated"), `first ${length} bytes`);
  }
  assert.deepEqual(checkPng(png, LIMITS), { width: 5, height: 3 });
});

test("refuses a PNG with a damaged byte in any chunk", () => {
  // The CRC covers chunk type and data: IHDR type 12-15, data 16-28, CRC 29-32;
  // IDAT data 41-59, CRC 60-63; IEND type 68-71, CRC 72-75.
  const png = fixture("gray16.png");
  for (const at of [12, 16, 28, 29, 41, 50, 59, 60, 68, 72, 75]) {
    const damaged = Buffer.from(png);
    damaged[at] = (damaged[at] as number) ^ 0x01;
    assert.throws(() => checkPng(damaged, LIMITS), problem("crc"), `byte ${at}`);
  }
});

test("refuses an IHDR that PNG does not allow or that is larger than the API can return", () => {
  const cases: Record<string, Header> = {
    "zero width": { width: 0, height: 2 },
    "zero height": { width: 3, height: 0 },
    "width over 8000": { width: 8001, height: 2 },
    "height over 20000": { width: 3, height: 20001 },
    "grayscale at bit depth 3": { width: 3, height: 2, bitDepth: 3 },
    "truecolor at bit depth 4": { width: 3, height: 2, colorType: 2, bitDepth: 4 },
    "palette at bit depth 16": { width: 3, height: 2, colorType: 3, bitDepth: 16 },
    "gray with alpha at bit depth 1": { width: 3, height: 2, colorType: 4, bitDepth: 1 },
    "color type 1": { width: 3, height: 2, colorType: 1 },
    "color type 5": { width: 3, height: 2, colorType: 5 },
    "compression method 1": { width: 3, height: 2, compression: 1 },
    "filter method 1": { width: 3, height: 2, filter: 1 },
    "interlace method 2": { width: 3, height: 2, interlace: 2 },
  };
  for (const [name, header] of Object.entries(cases)) {
    const png = pngOf([ihdr(header), idat(grayRows(3, 2)), IEND]);
    assert.throws(() => checkPng(png, LIMITS), problem("header"), name);
  }
  const long = { type: "IHDR", data: Buffer.concat([ihdr({ width: 3, height: 2 }).data, Buffer.alloc(1)]) };
  assert.throws(() => checkPng(pngOf([long, idat(grayRows(3, 2)), IEND]), LIMITS), problem("header"), "IHDR of 14 bytes");
  assert.deepEqual(checkPng(pngOf([ihdr({ width: 3, height: 2 }), idat(grayRows(3, 2)), IEND]), LIMITS), {
    width: 3,
    height: 2,
  });
});

test("refuses chunks in an order or form that PNG does not allow", () => {
  const header = ihdr({ width: 3, height: 2 });
  const data = idat(grayRows(3, 2));
  const text = { type: "tEXt", data: Buffer.from("k\0v") };
  // A 1-bit palette image, 3 pixels wide: 2 rows of a filter byte and 1 byte.
  const paletteHeader = ihdr({ width: 3, height: 2, colorType: 3, bitDepth: 1 });
  const palette = { type: "PLTE", data: Buffer.from([0, 0, 0, 255, 255, 255]) };
  const paletteData = idat(Buffer.from([0, 0b1010_0000, 0, 0b0100_0000]));
  // Truecolor 3x2 (rows of 1 + 9 bytes) may carry a suggested PLTE before IDAT.
  const rgbHeader = ihdr({ width: 3, height: 2, colorType: 2 });
  const rgbData = idat(Buffer.alloc(20));
  // Gray and alpha 3x2: rows of 1 + 6 bytes.
  const grayAlphaHeader = ihdr({ width: 3, height: 2, colorType: 4 });
  const grayAlphaData = idat(Buffer.alloc(14));
  const hugeLength = Buffer.from([0x80, 0, 0, 0, 0x49, 0x44, 0x41, 0x54]);

  const cases: Record<string, Buffer> = {
    "IDAT before IHDR": pngOf([data, header, IEND]),
    "IHDR twice": pngOf([header, header, data, IEND]),
    "no IDAT": pngOf([header, IEND]),
    "IDAT chunks that are not consecutive": pngOf([header, data, text, data, IEND]),
    "an unknown critical chunk": pngOf([header, { type: "ABCD", data: Buffer.from([1]) }, data, IEND]),
    "a chunk type with a digit": pngOf([header, { type: "tEX1", data: Buffer.alloc(0) }, data, IEND]),
    "a chunk length over 2^31-1": Buffer.concat([SIGNATURE, encodeChunk(header), hugeLength, Buffer.alloc(16)]),
    "IEND with data": pngOf([header, data, { type: "IEND", data: Buffer.alloc(4) }]),
    "a byte after IEND": Buffer.concat([pngOf([header, data, IEND]), Buffer.alloc(1)]),
    "a chunk after IEND": Buffer.concat([pngOf([header, data, IEND]), encodeChunk(text)]),
    "a palette image without PLTE": pngOf([paletteHeader, paletteData, IEND]),
    "PLTE in a grayscale image": pngOf([header, palette, data, IEND]),
    "PLTE in a gray and alpha image": pngOf([grayAlphaHeader, palette, grayAlphaData, IEND]),
    "PLTE after IDAT in a palette image": pngOf([paletteHeader, paletteData, palette, IEND]),
    "PLTE after IDAT in a truecolor image": pngOf([rgbHeader, rgbData, palette, IEND]),
    "PLTE twice": pngOf([paletteHeader, palette, palette, paletteData, IEND]),
    "PLTE that is not whole entries": pngOf([paletteHeader, { type: "PLTE", data: Buffer.alloc(4) }, paletteData, IEND]),
    "empty PLTE": pngOf([paletteHeader, { type: "PLTE", data: Buffer.alloc(0) }, paletteData, IEND]),
    "PLTE with more entries than 1 bit can index": pngOf([
      paletteHeader,
      { type: "PLTE", data: Buffer.alloc(9) },
      paletteData,
      IEND,
    ]),
  };
  for (const [name, png] of Object.entries(cases)) {
    assert.throws(() => checkPng(png, LIMITS), problem("structure"), name);
  }
  // The same parts in a permitted order are a valid file.
  assert.deepEqual(checkPng(pngOf([header, text, data, IEND]), LIMITS), { width: 3, height: 2 });
  assert.deepEqual(checkPng(pngOf([paletteHeader, palette, paletteData, IEND]), LIMITS), { width: 3, height: 2 });
  assert.deepEqual(checkPng(pngOf([rgbHeader, palette, rgbData, IEND]), LIMITS), { width: 3, height: 2 });
  assert.deepEqual(checkPng(pngOf([grayAlphaHeader, grayAlphaData, IEND]), LIMITS), { width: 3, height: 2 });
});

test("refuses image data that does not decompress to exactly the scanlines of the header", () => {
  // 3x2 grayscale 8-bit: 2 rows of a filter byte and 3 pixels, 8 bytes in all.
  const header = ihdr({ width: 3, height: 2 });
  const rows = grayRows(3, 2);
  assert.equal(rows.length, 8);
  const stream = deflateSync(rows);
  const flipped = (data: Buffer, at: number) => {
    const copy = Buffer.from(data);
    copy[at] = (copy[at] as number) ^ 0x01;
    return copy;
  };
  const cases: Record<string, Buffer> = {
    "an empty IDAT": Buffer.alloc(0),
    "data that is not a zlib stream": Buffer.from("definitely not deflate data"),
    "a zlib stream cut short": stream.subarray(0, stream.length - 5),
    "a wrong Adler-32 checksum": flipped(stream, stream.length - 1),
    "one byte too few": deflateSync(rows.subarray(0, 7)),
    "one byte too many": deflateSync(Buffer.concat([rows, Buffer.from([0])])),
    "filter type 5 in the second row": deflateSync(Buffer.from([0, 1, 2, 3, 5, 1, 2, 3])),
    "a byte after the zlib stream": Buffer.concat([stream, Buffer.alloc(1)]),
  };
  for (const [name, data] of Object.entries(cases)) {
    assert.throws(() => checkPng(pngOf([header, { type: "IDAT", data }, IEND]), LIMITS), problem("image-data"), name);
  }
  assert.deepEqual(checkPng(pngOf([header, { type: "IDAT", data: stream }, IEND]), LIMITS), { width: 3, height: 2 });
});

test("stops decompressing as soon as the image data outgrows its header", () => {
  const bomb = zeroBomb(1024);
  // The helper's stream really inflates past what it is: over 4 MiB here.
  assert.ok(bomb.length < 2 << 20, `bomb is ${bomb.length} bytes`);
  assert.throws(() => inflateSync(bomb, { maxOutputLength: 4 << 20 }), { code: "ERR_BUFFER_TOO_LARGE" });

  const png = pngOf([ihdr({ width: 3, height: 2 }), { type: "IDAT", data: bomb }, IEND]);
  const peakBefore = process.resourceUsage().maxRSS;
  assert.throws(() => checkPng(png, LIMITS), problem("image-data"));
  // Inflating the whole GiB would raise the peak resident size by about 1 GiB.
  const grownKiB = process.resourceUsage().maxRSS - peakBefore;
  assert.ok(grownKiB < 128 * 1024, `peak resident size grew by ${grownKiB} KiB`);
});

test("knows the exact scanline size of interlaced, 16-bit and sub-byte images", () => {
  // One byte fewer or more than the encoder wrote must be refused for each.
  for (const name of ["rgba-interlaced.png", "gray16.png", "palette.png"]) {
    const chunks = chunksOf(fixture(name));
    const short = pngOf(withIdat(chunks, (raw) => raw.subarray(0, raw.length - 1)));
    const long = pngOf(withIdat(chunks, (raw) => Buffer.concat([raw, Buffer.alloc(1)])));
    assert.throws(() => checkPng(short, LIMITS), problem("image-data"), `${name} one byte short`);
    assert.throws(() => checkPng(long, LIMITS), problem("image-data"), `${name} one byte long`);
    assert.doesNotThrow(() => checkPng(pngOf(withIdat(chunks, (raw) => raw)), LIMITS), `${name} recompressed`);
  }
});

test("the size limit is per side: 8000x20000 is not an oversized header, 8000x20001 is", () => {
  // The IDAT is far too small for either header, so a header that passes is
  // then refused for its image data instead.
  const png = pngOf([ihdr({ width: 8000, height: 20000 }), idat(grayRows(3, 2)), IEND]);
  assert.throws(() => checkPng(png, LIMITS), problem("image-data"));
  const oversized = pngOf([ihdr({ width: 8000, height: 20001 }), idat(grayRows(3, 2)), IEND]);
  assert.throws(() => checkPng(oversized, LIMITS), problem("header"));
});
