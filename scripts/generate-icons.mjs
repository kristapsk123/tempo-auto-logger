/**
 * Generates pink pony PNG icons for the Chrome extension.
 * Uses only Node.js built-in modules (zlib, fs, path).
 * Run: node scripts/generate-icons.mjs
 */
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'src', 'icons');

// ─── CRC32 ────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── PNG writer ───────────────────────────────────────────────────────────────
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([lb, tb, data, crcBuf]);
}

function encodePNG(width, height, pixels /* Uint8Array, RGBA rows */) {
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = ihdr[11] = ihdr[12] = 0;

  const raw = Buffer.allocUnsafe(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: None
    pixels.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Colour helpers ───────────────────────────────────────────────────────────
const TRANSPARENT = [0, 0, 0, 0];
const PINK        = [255, 105, 180, 255]; // hot pink  (#FF69B4)
const DEEP_PINK   = [255,  20, 147, 255]; // deep pink (#FF1493) – mane / tail
const EYE_DARK    = [ 40,  20,  60, 255]; // dark pupil
const EYE_SHINE   = [255, 255, 255, 255]; // eye-shine dot
const PINK_DARK   = [230,  70, 150, 255]; // hoof shading

// Blend two colours (src over dst)
function blend(dst, src) {
  const a = src[3] / 255;
  return [
    Math.round(src[0] * a + dst[0] * (1 - a)),
    Math.round(src[1] * a + dst[1] * (1 - a)),
    Math.round(src[2] * a + dst[2] * (1 - a)),
    Math.min(255, dst[3] + src[3]),
  ];
}

// ─── Geometry helpers (all coords in 0..1 space) ────────────────────────────
function inEllipse(nx, ny, cx, cy, rx, ry) {
  return ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2 <= 1;
}
function dist(nx, ny, cx, cy) {
  return Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);
}
function inCircle(nx, ny, cx, cy, r) {
  return dist(nx, ny, cx, cy) <= r;
}

// ─── Pony pixel renderer (normalised 0..1 coordinates) ────────────────────────
function ponyPixel(nx, ny) {
  // ── Tail (left side, deep-pink teardrop) ────────────────────────────────
  if (inEllipse(nx, ny, 0.12, 0.64, 0.09, 0.22)) return DEEP_PINK;

  // ── Body (pink ellipse) ─────────────────────────────────────────────────
  const inBody = inEllipse(nx, ny, 0.46, 0.68, 0.34, 0.21);

  // ── Neck (connect body to head) ─────────────────────────────────────────
  const inNeck =
    nx >= 0.60 && nx <= 0.77 &&
    ny >= 0.42 && ny <= 0.68 &&
    nx >= 0.60 + (ny - 0.42) * 0.08;  // slight diagonal taper

  // ── Head (pink circle) ──────────────────────────────────────────────────
  const inHead = inCircle(nx, ny, 0.80, 0.39, 0.19);

  // ── Snout (lighter ellipse protruding from head) ─────────────────────────
  const inSnout = inEllipse(nx, ny, 0.94, 0.50, 0.08, 0.06);

  // ── Ear (small triangle on head top) ────────────────────────────────────
  const inEar =
    nx >= 0.72 && nx <= 0.81 &&
    ny >= 0.20 && ny <= 0.32 &&
    (ny - 0.20) / 0.12 >= Math.abs(nx - 0.765) / 0.045;

  // ── Mane (deep-pink blobs along neck / head top) ─────────────────────────
  const maneBlobs = [
    [0.765, 0.22, 0.07],
    [0.69,  0.29, 0.07],
    [0.65,  0.37, 0.07],
    [0.63,  0.45, 0.06],
    [0.62,  0.53, 0.06],
  ];
  const inMane = maneBlobs.some(([cx, cy, r]) => inCircle(nx, ny, cx, cy, r));

  // ── Legs ─────────────────────────────────────────────────────────────────
  const legs = [
    [0.60, 0.68, 0.68, 0.76, 0.88],  // front-right  [x0,x1,bodyY,legTop,legBot]
    [0.50, 0.58, 0.68, 0.76, 0.88],  // front-left
    [0.26, 0.34, 0.68, 0.76, 0.88],  // back-right
    [0.16, 0.24, 0.68, 0.76, 0.88],  // back-left
  ];
  const inLeg = legs.some(([x0, x1, , legTop, legBot]) =>
    nx >= x0 && nx <= x1 && ny >= legTop && ny <= legBot,
  );
  // Hooves (darker strip at bottom of each leg)
  const inHoof = legs.some(([x0, x1, , , legBot]) =>
    nx >= x0 && nx <= x1 && ny >= legBot - 0.04 && ny <= legBot,
  );

  // ── Eye details ───────────────────────────────────────────────────────────
  const inEyeWhite = inCircle(nx, ny, 0.855, 0.36, 0.045);
  const inEyePupil = inCircle(nx, ny, 0.862, 0.363, 0.026);
  const inEyeShine = inCircle(nx, ny, 0.870, 0.352, 0.012);

  // ── Nostril ───────────────────────────────────────────────────────────────
  const inNostril = inCircle(nx, ny, 0.975, 0.53, 0.022);

  // ─── Compositing (back-to-front) ─────────────────────────────────────────
  if (inHoof)       return PINK_DARK;
  if (inLeg)        return PINK;
  if (inMane && !inHead && !inNeck && !inBody) return DEEP_PINK; // tail-side mane
  if (inMane && (inHead || inNeck || inBody))  return DEEP_PINK;
  if (inSnout)      return PINK;
  if (inHead)       return PINK;
  if (inEar)        return PINK;
  if (inNeck)       return PINK;
  if (inBody)       return PINK;

  if (inEyeShine)   return EYE_SHINE;
  if (inEyePupil)   return EYE_DARK;
  if (inEyeWhite)   return EYE_SHINE;
  if (inNostril)    return PINK_DARK;

  return TRANSPARENT;
}

// ─── Render at a given size ───────────────────────────────────────────────────
function renderPony(size) {
  const pixels = Buffer.allocUnsafe(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Super-sample 2×2 for anti-aliasing
      const samples = [
        ponyPixel((x + 0.25) / size, (y + 0.25) / size),
        ponyPixel((x + 0.75) / size, (y + 0.25) / size),
        ponyPixel((x + 0.25) / size, (y + 0.75) / size),
        ponyPixel((x + 0.75) / size, (y + 0.75) / size),
      ];
      const avg = [0, 0, 0, 0];
      for (const s of samples) { avg[0] += s[0]; avg[1] += s[1]; avg[2] += s[2]; avg[3] += s[3]; }
      const off = (y * size + x) * 4;
      pixels[off]     = Math.round(avg[0] / 4);
      pixels[off + 1] = Math.round(avg[1] / 4);
      pixels[off + 2] = Math.round(avg[2] / 4);
      pixels[off + 3] = Math.round(avg[3] / 4);
    }
  }
  return pixels;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const pixels = renderPony(size);
  const png = encodePNG(size, size, pixels);
  const outPath = path.join(OUT_DIR, `pony${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ ${outPath} (${png.length} bytes)`);
}

console.log('\nIcons written to src/icons/');
