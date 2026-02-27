#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Generates minimal valid PNG template icons for a macOS menu bar tray app.
 * Produces:
 *   - IconTemplate.png    (18x18)
 *   - IconTemplate@2x.png (36x36)
 *
 * Each icon is a bell shape drawn with black pixels (alpha = 255) on a
 * fully transparent background.  macOS "template images" use the alpha
 * channel to derive the visible shape, so we only need black + transparent.
 *
 * No external dependencies - uses only the Node.js standard library.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- PNG primitives ---

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuffer, data]);
  const crcValue = Buffer.alloc(4);
  crcValue.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([length, typeBuffer, data, crcValue]);
}

function buildPNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(Buffer.from([0])); // filter byte: None
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      row[x * 4 + 0] = rgba[idx + 0];
      row[x * 4 + 1] = rgba[idx + 1];
      row[x * 4 + 2] = rgba[idx + 2];
      row[x * 4 + 3] = rgba[idx + 3];
    }
    rawRows.push(row);
  }
  const rawData = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(rawData);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Icon drawing ---

function drawBell(size) {
  const rgba = new Uint8Array(size * size * 4);

  function setPixel(x, y) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    rgba[idx + 0] = 0;
    rgba[idx + 1] = 0;
    rgba[idx + 2] = 0;
    rgba[idx + 3] = 255;
  }

  function fillCircle(cx, cy, r) {
    const r2 = r * r;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy <= r2) {
          setPixel(Math.round(cx + dx), Math.round(cy + dy));
        }
      }
    }
  }

  function fillRect(x1, y1, x2, y2) {
    for (let y = Math.round(y1); y <= Math.round(y2); y++) {
      for (let x = Math.round(x1); x <= Math.round(x2); x++) {
        setPixel(x, y);
      }
    }
  }

  const s = size;
  const cx = s / 2;

  // Bell dome (top arc)
  const domeRadius = s * 0.28;
  const domeCy = s * 0.32;
  fillCircle(cx, domeCy, domeRadius);

  // Bell body (flared shape from dome to lip)
  const bodyTop = domeCy + domeRadius * 0.4;
  const bodyBottom = s * 0.68;
  const bodyRows = Math.round(bodyBottom - bodyTop);
  for (let i = 0; i <= bodyRows; i++) {
    const t = i / Math.max(bodyRows, 1);
    const halfWidth = domeRadius + t * (s * 0.15);
    const y = Math.round(bodyTop + i);
    for (let x = Math.round(cx - halfWidth); x <= Math.round(cx + halfWidth); x++) {
      setPixel(x, y);
    }
  }

  // Bell lip (horizontal bar)
  const lipHalfW = domeRadius + s * 0.18;
  const lipY1 = Math.round(s * 0.68);
  const lipY2 = Math.round(s * 0.73);
  fillRect(Math.round(cx - lipHalfW), lipY1, Math.round(cx + lipHalfW), lipY2);

  // Clapper (small circle below)
  const clapperR = s * 0.07;
  const clapperCy = s * 0.8;
  fillCircle(cx, clapperCy, clapperR);

  // Knob on top (tiny circle)
  const knobR = s * 0.06;
  const knobCy = s * 0.14;
  fillCircle(cx, knobCy, knobR);

  return Buffer.from(rgba);
}

// --- Main ---

const assetsDir = path.resolve(__dirname, '..', 'assets');

const sizes = [
  { file: 'IconTemplate.png', size: 18 },
  { file: 'IconTemplate@2x.png', size: 36 },
];

for (const { file, size } of sizes) {
  const rgba = drawBell(size);
  const png = buildPNG(size, size, rgba);
  const dest = path.join(assetsDir, file);
  fs.writeFileSync(dest, png);
  console.log(`Created ${dest}  (${size}x${size}, ${png.length} bytes)`);
}

console.log('\nDone.');
