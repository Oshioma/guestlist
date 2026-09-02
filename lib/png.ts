// A PNG WRITER, BECAUSE AN EMAIL CANNOT RUN CODE.
//
// The door pass needs its QR code as an image the mail client will draw
// unaided — no SVG, no canvas, no JavaScript. PNG is the one format every
// client renders, and writing one is small: a signature, three chunks, and a
// CRC on each.
//
// Greyscale, 8 bits, no interlacing. That is all a black-and-white QR needs,
// and it keeps the file small enough to sit in an inbox without complaint.

import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([head, typed, crc]);
}

/**
 * An 8-bit greyscale PNG. `pixels` is one byte per pixel, row-major,
 * `width * height` long — 0 is black, 255 is white.
 */
export function greyscalePng(width: number, height: number, pixels: Uint8Array): Buffer {
  if (pixels.length !== width * height) {
    throw new Error(`Expected ${width * height} pixels, got ${pixels.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // colour type: greyscale
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // Every scanline is prefixed with its filter type. Filter 0 (none) keeps
  // this readable and compresses fine on an image with two colours.
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Render a QR matrix as a PNG: `scale` pixels per module, and a quiet border
 * of `quiet` modules. The border is not decoration — a scanner needs the clear
 * margin to find the code at all, and an email background will not provide it.
 */
export function qrPng(
  matrix: { size: number; get: (r: number, c: number) => boolean },
  scale = 8,
  quiet = 4
): Buffer {
  const modules = matrix.size + quiet * 2;
  const side = modules * scale;
  const pixels = new Uint8Array(side * side).fill(255);
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (!matrix.get(r, c)) continue;
      const y0 = (r + quiet) * scale;
      const x0 = (c + quiet) * scale;
      for (let y = y0; y < y0 + scale; y++) pixels.fill(0, y * side + x0, y * side + x0 + scale);
    }
  }
  return greyscalePng(side, side, pixels);
}
