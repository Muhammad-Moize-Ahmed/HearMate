/**
 * Placeholder app icons, drawn here with no dependencies and nothing downloaded: the HearMate mark
 * (the round face with sound waves from `src/components/ui/Logo.tsx`) on the brand violet.
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes into public/icons/. To use final artwork instead, replace those files keeping the same
 * names and sizes (see the frontend README), and stop running this script.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// The same colours as src/index.css.
const BRAND = '#6d28d9';
const SUN = '#fde047';
const INK = '#1e1b4b';
const CORAL = '#fda4af';
const WHITE = '#ffffff';

/**
 * The mark in the Logo's 64-unit space. Arcs are the Logo's SVG paths as circles: centre, radius,
 * angle range in degrees (y points down) and stroke width.
 */
const MARK = [
  { type: 'circle', cx: 28, cy: 34, r: 22, color: SUN },
  { type: 'circle', cx: 21, cy: 31, r: 3, color: INK },
  { type: 'circle', cx: 34, cy: 31, r: 3, color: INK },
  { type: 'arc', cx: 27.5, cy: 33.125, r: 10.875, from: 46.4, to: 133.6, width: 3, color: INK },
  { type: 'circle', cx: 13, cy: 39, r: 3, color: CORAL },
  { type: 'circle', cx: 42, cy: 39, r: 3, color: CORAL },
  { type: 'arc', cx: 40.2, cy: 30, r: 14, from: -45.6, to: 45.6, width: 4, color: WHITE },
  { type: 'arc', cx: 40.9, cy: 30, r: 22, from: -46.6, to: 46.6, width: 4, color: WHITE },
];
/** The middle of the mark's bounding box, so it can be centred. */
const MARK_CENTRE = { x: 32, y: 34 };

/**
 * @param size pixels per side
 * @param scale how much of the icon the mark fills (maskable icons keep it inside the safe zone)
 * @param corner rounded-corner radius as a fraction of the side (0 = full-bleed square)
 */
function drawIcon(size, { scale, corner }) {
  const shapes = MARK.map((shape) => ({
    ...shape,
    cx: 32 + (shape.cx - MARK_CENTRE.x) * scale,
    cy: 32 + (shape.cy - MARK_CENTRE.y) * scale,
    r: shape.r * scale,
    width: (shape.width ?? 0) * scale,
  }));
  const background = { type: 'rounded', radius: corner * 64, color: BRAND };
  const pixels = Buffer.alloc(size * size * 4);
  const SAMPLES = 4; // 4×4 samples per pixel for smooth edges

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 64;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 64;
          if (!inside(background, x, y)) continue;
          let color = background.color;
          for (const shape of shapes) if (inside(shape, x, y)) color = shape.color;
          const [cr, cg, cb] = rgb(color);
          r += cr;
          g += cg;
          b += cb;
          a += 1;
        }
      }
      const i = (py * size + px) * 4;
      const n = SAMPLES * SAMPLES;
      // Colour averaged over the covered samples; alpha is the coverage.
      pixels[i] = a ? Math.round(r / a) : 0;
      pixels[i + 1] = a ? Math.round(g / a) : 0;
      pixels[i + 2] = a ? Math.round(b / a) : 0;
      pixels[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, pixels);
}

function inside(shape, x, y) {
  switch (shape.type) {
    case 'rounded': {
      const k = shape.radius;
      const dx = Math.max(k - x, 0, x - (64 - k));
      const dy = Math.max(k - y, 0, y - (64 - k));
      return dx * dx + dy * dy <= k * k;
    }
    case 'circle':
      return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
    case 'arc': {
      const half = shape.width / 2;
      const dist = Math.hypot(x - shape.cx, y - shape.cy);
      const angle = (Math.atan2(y - shape.cy, x - shape.cx) * 180) / Math.PI;
      if (Math.abs(dist - shape.r) <= half && angle >= shape.from && angle <= shape.to) return true;
      // Round caps at both ends.
      return [shape.from, shape.to].some((deg) => {
        const t = (deg * Math.PI) / 180;
        const ex = shape.cx + shape.r * Math.cos(t);
        const ey = shape.cy + shape.r * Math.sin(t);
        return (x - ex) ** 2 + (y - ey) ** 2 <= half * half;
      });
    }
  }
  return false;
}

function rgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// --- A minimal PNG encoder (8-bit RGBA, no filtering). ---

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The same mark as an SVG, for the browser tab. */
function faviconSvg() {
  const scale = 0.82;
  const at = (v, c) => +(32 + (v - c) * scale).toFixed(2);
  const parts = MARK.map((s) => {
    const cx = at(s.cx, MARK_CENTRE.x);
    const cy = at(s.cy, MARK_CENTRE.y);
    const r = +(s.r * scale).toFixed(2);
    if (s.type === 'circle') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"/>`;
    const point = (deg) => {
      const t = (deg * Math.PI) / 180;
      return `${+(cx + r * Math.cos(t)).toFixed(2)} ${+(cy + r * Math.sin(t)).toFixed(2)}`;
    };
    return (
      `<path d="M${point(s.from)}A${r} ${r} 0 0 1 ${point(s.to)}" fill="none" ` +
      `stroke="${s.color}" stroke-width="${+(s.width * scale).toFixed(2)}" stroke-linecap="round"/>`
    );
  });
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${BRAND}"/>${parts.join('')}</svg>\n`
  );
}

const ICONS = [
  // Manifest "any" icons: rounded square, transparent corners.
  { file: 'icon-192.png', size: 192, scale: 0.82, corner: 0.22 },
  { file: 'icon-512.png', size: 512, scale: 0.82, corner: 0.22 },
  // Maskable: full bleed; the mark stays inside the central 80% circle that every mask keeps.
  { file: 'maskable-192.png', size: 192, scale: 0.68, corner: 0 },
  { file: 'maskable-512.png', size: 512, scale: 0.68, corner: 0 },
  // iOS rounds the corners itself and shows transparency as black, so this one is opaque.
  { file: 'apple-touch-icon.png', size: 180, scale: 0.76, corner: 0 },
  { file: 'favicon-32.png', size: 32, scale: 0.9, corner: 0.22 },
];

mkdirSync(OUT, { recursive: true });
for (const { file, size, scale, corner } of ICONS) {
  writeFileSync(join(OUT, file), drawIcon(size, { scale, corner }));
  console.log(`public/icons/${file} (${size}×${size})`);
}
writeFileSync(join(OUT, 'favicon.svg'), faviconSvg());
console.log('public/icons/favicon.svg');
