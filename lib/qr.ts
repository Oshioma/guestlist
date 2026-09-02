// A QR CODE, WITH NOTHING ADDED TO THE BUILD.
//
// One thing on a guestlist email has to survive a dark room, a cracked screen
// and a stranger's phone: the code the door scans. That is worth writing out
// properly rather than pulling a package tree in for it — this file has no
// imports at all.
//
// Byte mode, error correction level M, versions 1–10. That covers any URL this
// site will ever put on a door pass (213 bytes at version 10) and stops well
// short of the sizes where a phone camera starts struggling.
//
// The maths is ISO/IEC 18004: a Reed–Solomon code over GF(256), interleaved
// into blocks, laid into the matrix in a zigzag around the function patterns,
// then masked with whichever of eight patterns scores best. The tests check
// this against a reference implementation, module for module.

// --- GF(256), the field Reed–Solomon lives in --------------------------------
// x^8 + x^4 + x^3 + x^2 + 1, the polynomial QR uses.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// The generator polynomial for `n` error-correction codewords:
// (x - a^0)(x - a^1)…(x - a^(n-1)).
function generator(n: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < n; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= mul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Polynomial long division; the remainder IS the error correction.
function ecCodewords(data: Uint8Array, count: number): Uint8Array {
  const gen = generator(count);
  const rem = new Uint8Array(data.length + count);
  rem.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = rem[i];
    if (factor === 0) continue;
    for (let j = 0; j < gen.length; j++) rem[i + j] ^= mul(gen[j], factor);
  }
  return rem.slice(data.length);
}

// --- Version tables (level M only) -------------------------------------------
// [ec codewords per block, group 1 blocks, group 1 data codewords,
//  group 2 blocks, group 2 data codewords]
const BLOCKS_M: Record<number, [number, number, number, number, number]> = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

// Row/column centres of the alignment patterns, by version.
const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

export const MAX_VERSION = 10;
const dataCodewords = (v: number) => {
  const [, b1, d1, b2, d2] = BLOCKS_M[v];
  return b1 * d1 + b2 * d2;
};
// Byte mode: 4 mode bits, then the length (8 bits to version 9, 16 from 10).
const lengthBits = (v: number) => (v < 10 ? 8 : 16);
export const byteCapacity = (v: number) => dataCodewords(v) - Math.ceil((4 + lengthBits(v)) / 8);

// --- Bit stream --------------------------------------------------------------
class Bits {
  readonly bytes: number[] = [];
  private len = 0;
  push(value: number, width: number) {
    for (let i = width - 1; i >= 0; i--) {
      const bit = (value >> i) & 1;
      if (this.len % 8 === 0) this.bytes.push(0);
      if (bit) this.bytes[this.bytes.length - 1] |= 0x80 >> (this.len % 8);
      this.len++;
    }
  }
  get bitLength() { return this.len; }
}

// --- Format and version information ------------------------------------------
// BCH(15,5) over the 5 bits of (ec level, mask), then XORed so an all-zero
// format never looks like a blank region.
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;          // 0b00 is error correction level M
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  return ((data << 10) | rem) ^ 0x5412;
}

// BCH(18,6). Only versions 7 and up carry it.
function versionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  return (version << 12) | rem;
}

// --- The matrix --------------------------------------------------------------
type Grid = { size: number; on: Uint8Array; fixed: Uint8Array };

const at = (g: Grid, r: number, c: number) => g.on[r * g.size + c];
const set = (g: Grid, r: number, c: number, on: boolean, fixed = true) => {
  g.on[r * g.size + c] = on ? 1 : 0;
  if (fixed) g.fixed[r * g.size + c] = 1;
};

function functionPatterns(version: number): Grid {
  const size = version * 4 + 17;
  const g: Grid = { size, on: new Uint8Array(size * size), fixed: new Uint8Array(size * size) };

  // Three finder patterns, each with its separator of quiet modules.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = top + r, cc = left + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
        set(g, rr, cc, r >= 0 && r <= 6 && c >= 0 && c <= 6 && ring !== 2);
      }
    }
  }

  // Alignment patterns, everywhere except under a finder.
  const centres = ALIGNMENT[version];
  for (const r of centres) {
    for (const c of centres) {
      const underFinder =
        (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (underFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(g, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Timing patterns: the alternating spine that tells a scanner the module size.
  for (let i = 8; i < size - 8; i++) {
    set(g, 6, i, i % 2 === 0);
    set(g, i, 6, i % 2 === 0);
  }

  // The dark module, always on, always here.
  set(g, size - 8, 8, true);

  // Reserve the format areas; the real bits go in once the mask is chosen.
  for (let i = 0; i < 9; i++) {
    if (i !== 6) { set(g, 8, i, false); set(g, i, 8, false); }
  }
  for (let i = 0; i < 8; i++) {
    set(g, 8, size - 1 - i, false);
    if (i < 7) set(g, size - 1 - i, 8, false);
  }

  // Version information, versions 7 and up.
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const on = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3), b = (i % 3) + size - 11;
      set(g, a, b, on);
      set(g, b, a, on);
    }
  }
  return g;
}

function placeFormat(g: Grid, mask: number) {
  const bits = formatBits(mask);
  const size = g.size;
  // The spec numbers these bits from the most significant, and that is the
  // order they go into the matrix: bit 14 first, at (8, 0).
  for (let i = 0; i < 15; i++) {
    const on = ((bits >> (14 - i)) & 1) === 1;
    // Around the top-left finder, skipping the timing row and column.
    if (i < 6) set(g, 8, i, on);
    else if (i === 6) set(g, 8, 7, on);
    else if (i === 7) set(g, 8, 8, on);
    else if (i === 8) set(g, 7, 8, on);
    else set(g, 14 - i, 8, on);
    // And the copy split between the other two finders. Seven modules run up
    // column 8 from the bottom; the eighth position there is the dark module,
    // so the horizontal half starts at bit 7.
    if (i < 7) set(g, size - 1 - i, 8, on);
    else set(g, 8, size - 15 + i, on);
  }
}

// Data winds up the right edge and back down, two columns at a time, skipping
// the column the vertical timing pattern occupies.
function placeData(g: Grid, codewords: Uint8Array) {
  const size = g.size;
  let bit = 0;
  const total = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (g.fixed[row * size + col]) continue;
        const on = bit < total && ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        set(g, row, col, on, false);
        bit++;
      }
    }
    upward = !upward;
  }
}

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

// The four penalty rules. A scanner reads any mask; these pick the one least
// likely to be confused with the finder patterns or to wash out into blocks.
function penalty(g: Grid): number {
  const size = g.size;
  let score = 0;
  let dark = 0;

  const runPenalty = (run: number) => (run >= 5 ? 3 + (run - 5) : 0);
  for (let i = 0; i < size; i++) {
    let rowRun = 1, colRun = 1;
    for (let j = 1; j < size; j++) {
      rowRun = at(g, i, j) === at(g, i, j - 1) ? rowRun + 1 : (score += runPenalty(rowRun), 1);
      colRun = at(g, j, i) === at(g, j - 1, i) ? colRun + 1 : (score += runPenalty(colRun), 1);
    }
    score += runPenalty(rowRun) + runPenalty(colRun);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (at(g, r, c)) dark++;
      if (r + 1 < size && c + 1 < size) {
        const v = at(g, r, c);
        if (v === at(g, r, c + 1) && v === at(g, r + 1, c) && v === at(g, r + 1, c + 1)) score += 3;
      }
    }
  }

  // 1:1:3:1:1 with four light modules on one side — the finder's signature,
  // and the thing a scanner must never mistake for one. Read as an 11-module
  // sliding window: 10111010000 or 00001011101.
  for (let i = 0; i < size; i++) {
    let row = 0, col = 0;
    for (let j = 0; j < size; j++) {
      row = ((row << 1) & 0x7ff) | at(g, i, j);
      col = ((col << 1) & 0x7ff) | at(g, j, i);
      if (j >= 10) {
        if (row === 0x5d0 || row === 0x05d) score += 40;
        if (col === 0x5d0 || col === 0x05d) score += 40;
      }
    }
  }

  // How far from half dark, in five-percent steps.
  score += Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10) * 10;
  return score;
}

// --- The whole thing ---------------------------------------------------------

export type QrMatrix = { size: number; get: (r: number, c: number) => boolean };

/**
 * Encode `text` as a QR code matrix at error correction level M.
 *
 * Throws when the text is longer than a version 10 code can carry (213 bytes),
 * which is far more than any URL this site produces.
 *
 * `forceMask` exists for the tests: pinning the mask lets them compare this
 * against a reference implementation one mask at a time, so a difference can
 * only ever mean an encoding bug and never a difference of taste in the
 * mask-scoring heuristic.
 */
export function encodeQr(text: string, forceMask?: number): QrMatrix {
  const data = new TextEncoder().encode(text);
  const version = Number(
    Object.keys(BLOCKS_M).find((v) => data.length <= byteCapacity(Number(v)))
  );
  if (!version) {
    throw new Error(`Too long for a QR code: ${data.length} bytes, ${byteCapacity(MAX_VERSION)} is the most`);
  }

  // Mode, length, payload, terminator, then padding to fill the version.
  const bits = new Bits();
  bits.push(0b0100, 4);
  bits.push(data.length, lengthBits(version));
  for (const b of data) bits.push(b, 8);
  const capacityBits = dataCodewords(version) * 8;
  bits.push(0, Math.min(4, capacityBits - bits.bitLength));
  if (bits.bitLength % 8) bits.push(0, 8 - (bits.bitLength % 8));
  const padded = bits.bytes.slice();
  for (let i = 0; padded.length < dataCodewords(version); i++) padded.push(i % 2 === 0 ? 0xec : 0x11);

  // Split into blocks, error-correct each, then interleave — so a scratch
  // across the code damages a little of every block rather than all of one.
  const [ecPerBlock, g1, d1, g2, d2] = BLOCKS_M[version];
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;
  for (let i = 0; i < g1 + g2; i++) {
    const size = i < g1 ? d1 : d2;
    const chunk = new Uint8Array(padded.slice(offset, offset + size));
    offset += size;
    blocks.push({ data: chunk, ec: ecCodewords(chunk, ecPerBlock) });
  }
  const out: number[] = [];
  for (let i = 0; i < Math.max(d1, d2); i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const b of blocks) out.push(b.ec[i]);
  }

  // Try every mask; keep the one the spec's penalty rules like best.
  let best: Grid | null = null;
  let bestScore = Infinity;
  const masks = forceMask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [forceMask];
  for (const mask of masks) {
    const g = functionPatterns(version);
    placeData(g, new Uint8Array(out));
    for (let r = 0; r < g.size; r++) {
      for (let c = 0; c < g.size; c++) {
        if (!g.fixed[r * g.size + c] && MASKS[mask](r, c)) g.on[r * g.size + c] ^= 1;
      }
    }
    placeFormat(g, mask);
    const score = penalty(g);
    if (score < bestScore) { bestScore = score; best = g; }
  }
  const grid = best!;
  return { size: grid.size, get: (r, c) => at(grid, r, c) === 1 };
}
