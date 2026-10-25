// Checks that the bytes Site-Shot returned are one complete, well-formed PNG
// before anything is written: the signature, every chunk and its CRC, the
// rules for the critical chunks, and image data that decompresses to exactly
// the scanlines its header describes. A valid PNG says nothing about what the
// page showed.
import { crc32, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_CHUNK_LENGTH = 0x7fff_ffff;
const CHUNK_TYPE = /^[A-Za-z]{4}$/;

/** Channels and permitted bit depths of each PNG color type. */
const COLOR_TYPES = new Map([
  [0, { channels: 1, depths: [1, 2, 4, 8, 16] }], // grayscale
  [2, { channels: 3, depths: [8, 16] }], // truecolor
  [3, { channels: 1, depths: [1, 2, 4, 8] }], // palette
  [4, { channels: 2, depths: [8, 16] }], // grayscale and alpha
  [6, { channels: 4, depths: [8, 16] }], // truecolor and alpha
]);

/** Adam7 passes: first column, first row, column step, row step. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;
const SINGLE_PASS = [[0, 0, 1, 1]] as const;

export type PngProblem = "not-png" | "truncated" | "crc" | "header" | "structure" | "image-data";

const PROBLEMS: Record<PngProblem, string> = {
  "not-png": "it is not a PNG image",
  truncated: "the PNG is incomplete",
  crc: "a PNG chunk failed its CRC check",
  header: "the PNG header is invalid or larger than the API can return",
  structure: "the PNG chunks are malformed or out of order",
  "image-data": "the PNG image data does not match its header",
};

export class PngError extends Error {
  readonly problem: PngProblem;

  constructor(problem: PngProblem) {
    super(PROBLEMS[problem]);
    this.name = "PngError";
    this.problem = problem;
  }
}

export interface PngLimits {
  maxWidth: number;
  maxHeight: number;
}

export interface PngSize {
  width: number;
  height: number;
}

interface Header extends PngSize {
  bitDepth: number;
  colorType: number;
  bitsPerPixel: number;
  interlaced: boolean;
}

interface Chunk {
  type: string;
  body: Buffer;
  next: number;
}

/** Returns the dimensions of a valid PNG; throws {@link PngError} otherwise. */
export function checkPng(data: Uint8Array, limits: PngLimits): PngSize {
  const png = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (!png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) throw new PngError("not-png");

  const first = readChunk(png, SIGNATURE.length);
  if (first.type !== "IHDR") throw new PngError("structure");
  const header = readHeader(first.body, limits);

  let palette = false;
  const imageData: Buffer[] = [];
  let imageDataEnded = false;
  for (let at = first.next; ; ) {
    const { type, body, next } = readChunk(png, at);
    at = next;
    if (type === "IDAT") {
      // All IDAT chunks are consecutive, and a palette image has its PLTE first.
      if (imageDataEnded || (header.colorType === 3 && !palette)) throw new PngError("structure");
      imageData.push(body);
      continue;
    }
    imageDataEnded = imageData.length > 0;
    if (type === "IEND") {
      // IEND is empty and last, after the image data.
      if (body.length !== 0 || imageData.length === 0 || at !== png.length) throw new PngError("structure");
      break;
    }
    if (type === "PLTE") {
      checkPalette(body, header, palette || imageData.length > 0);
      palette = true;
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      // Any other critical chunk: a second IHDR, or one PNG does not define.
      throw new PngError("structure");
    }
  }

  checkImageData(Buffer.concat(imageData), header);
  return { width: header.width, height: header.height };
}

function readChunk(png: Buffer, at: number): Chunk {
  if (png.length - at < 12) throw new PngError("truncated");
  const length = png.readUInt32BE(at);
  if (length > MAX_CHUNK_LENGTH) throw new PngError("structure");
  const next = at + 12 + length;
  if (next > png.length) throw new PngError("truncated");
  // The CRC covers the chunk type and data, not the length.
  if (crc32(png.subarray(at + 4, next - 4)) !== png.readUInt32BE(next - 4)) throw new PngError("crc");
  const type = png.toString("latin1", at + 4, at + 8);
  if (!CHUNK_TYPE.test(type)) throw new PngError("structure");
  return { type, body: png.subarray(at + 8, next - 4), next };
}

function readHeader(body: Buffer, limits: PngLimits): Header {
  if (body.length !== 13) throw new PngError("header");
  const width = body.readUInt32BE(0);
  const height = body.readUInt32BE(4);
  const bitDepth = body.readUInt8(8);
  const colorType = body.readUInt8(9);
  const color = COLOR_TYPES.get(colorType);
  if (
    width === 0 ||
    height === 0 ||
    width > limits.maxWidth ||
    height > limits.maxHeight ||
    color === undefined ||
    !color.depths.includes(bitDepth) ||
    body.readUInt8(10) !== 0 || // compression method
    body.readUInt8(11) !== 0 || // filter method
    body.readUInt8(12) > 1 // interlace method: none or Adam7
  ) {
    throw new PngError("header");
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    bitsPerPixel: color.channels * bitDepth,
    interlaced: body.readUInt8(12) === 1,
  };
}

/** PLTE: once, before the image data, 1 to 256 RGB entries (at most 2^depth for palette images), never in grayscale. */
function checkPalette(body: Buffer, header: Header, late: boolean): void {
  const entries = body.length / 3;
  const maxEntries = header.colorType === 3 ? 2 ** header.bitDepth : 256;
  if (
    late ||
    header.colorType === 0 ||
    header.colorType === 4 ||
    !Number.isInteger(entries) ||
    entries < 1 ||
    entries > maxEntries
  ) {
    throw new PngError("structure");
  }
}

function checkImageData(stream: Buffer, header: Header): void {
  // [number of rows, bytes per row including its filter-type byte] per pass.
  const rows = (header.interlaced ? ADAM7 : SINGLE_PASS).flatMap(([column, row, columnStep, rowStep]) => {
    const passWidth = Math.ceil((header.width - column) / columnStep);
    const passHeight = Math.ceil((header.height - row) / rowStep);
    return passWidth > 0 && passHeight > 0
      ? [[passHeight, 1 + Math.ceil((passWidth * header.bitsPerPixel) / 8)] as const]
      : [];
  });
  const expected = rows.reduce((sum, [count, length]) => sum + count * length, 0);

  let raw: Buffer;
  let consumed: number;
  try {
    // `info` also returns the engine, whose bytesWritten is the input that
    // zlib consumed; maxOutputLength stops a stream larger than the header.
    const result = inflateSync(stream, { maxOutputLength: expected, info: true }) as unknown as {
      buffer: Buffer;
      engine: { bytesWritten: number };
    };
    raw = result.buffer;
    consumed = result.engine.bytesWritten;
  } catch {
    throw new PngError("image-data");
  }
  if (raw.length !== expected || consumed !== stream.length) throw new PngError("image-data");

  // Every scanline starts with a filter type, 0 to 4.
  let at = 0;
  for (const [count, length] of rows) {
    for (let index = 0; index < count; index += 1, at += length) {
      if (raw.readUInt8(at) > 4) throw new PngError("image-data");
    }
  }
}
