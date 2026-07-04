// 纯 Node.js PNG 图标生成器 — 无需任何依赖
import { createWriteStream } from "fs";
import { deflateSync } from "zlib";
import { createHash } from "crypto";

function crc32(buf) {
  // CRC-32 for PNG chunk validation
  let c = 0xffffffff;
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let cc = n;
    for (let k = 0; k < 8; k++) cc = cc & 1 ? 0xedb88320 ^ (cc >>> 1) : cc >>> 1;
    table[n] = cc;
  }
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function makePNG(size, r, g, b, a = 255) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with filter byte 0 on each row
  const rawRows = [];
  // Simple sync icon: blue circle with white "S" pattern
  const half = size / 2;
  const thick = Math.max(1, Math.floor(size / 12));

  for (let y = 0; y < size; y++) {
    const row = [0]; // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - half;
      const dy = y - half;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const radius = half - 1;

      // Circle background
      if (dist <= radius) {
        // Simple sync-like arrow pattern
        const inLeft = x < half - thick * 1.5;
        const inRight = x > half + thick * 0.5;
        const inTop = y < half - thick;
        const inBot = y > half + thick;
        const inMidH = Math.abs(y - half) < thick;

        // Draw circular arrows (simplified sync symbol)
        const arrowBody =
          (inTop && inRight && y > thick) ||
          (inBot && inLeft && y < size - thick) ||
          (inMidH && Math.abs(x - xForY(y, half, thick, size)) < thick * 2);

        if (dist > radius - thick && dist <= radius) {
          // Circle border
          row.push(r, g, b, a);
        } else if (arrowBody && dist <= radius - thick) {
          // Arrow body
          row.push(255, 255, 255, a);
        } else if (dist <= radius) {
          // Filled area
          row.push(r, g, b, a);
        } else {
          row.push(0, 0, 0, 0);
        }
      } else {
        row.push(0, 0, 0, 0); // transparent
      }
    }
    rawRows.push(Buffer.from(row));
  }

  const raw = Buffer.concat(rawRows);
  const idat = deflateSync(raw);

  return Buffer.concat([sig, makeChunk("IHDR", ihdr), makeChunk("IDAT", idat), makeChunk("IEND", Buffer.alloc(0))]);
}

function xForY(y, half, thick, size) {
  // Helper for arrow positioning
  if (y < half) return half + thick * 1.5;
  if (y > half) return half - thick * 2.5;
  return half;
}

// Generate icons at 3 sizes
const blue = [59, 130, 246]; // #3b82f6

for (const size of [16, 48, 128]) {
  const png = makePNG(size, ...blue);
  const out = createWriteStream(`public/icons/icon${size}.png`);
  out.write(png);
  out.end();
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
}
