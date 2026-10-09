// Generates media/icon.png (128x128) without external dependencies.
// Uses PNG specification: 8-bit RGBA, no compression (zlib stored blocks are
// avoided via a simple RLE-free deflate "stored" stream).
// The icon is a simple cloud with a percentage glyph.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const W = 128;
const H = 128;

// RGBA pixel buffer
const px = Buffer.alloc(W * H * 4, 0);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r;
  px[i + 1] = g;
  px[i + 2] = b;
  px[i + 3] = a;
}

function fillRect(x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      setPx(x, y, r, g, b, a);
    }
  }
}

function fillCircle(cx, cy, radius, r, g, b, a = 255) {
  for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
    for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setPx(x, y, r, g, b, a);
      }
    }
  }
}

function fillRoundRect(x0, y0, x1, y1, radius, r, g, b, a = 255) {
  fillRect(x0 + radius, y0, x1 - radius, y1, r, g, b, a);
  fillRect(x0, y0 + radius, x1, y1 - radius, r, g, b, a);
  fillCircle(x0 + radius, y0 + radius, radius, r, g, b, a);
  fillCircle(x1 - radius, y0 + radius, radius, r, g, b, a);
  fillCircle(x0 + radius, y1 - radius, radius, r, g, b, a);
  fillCircle(x1 - radius, y1 - radius, radius, r, g, b, a);
}

// Background: rounded square, dark
fillRoundRect(4, 4, 123, 123, 24, 30, 30, 34);

// Cloud: white
const cloud = [64, 84, 96]; // RGB

// Cloud body (three lumps)
fillCircle(48, 62, 18, ...cloud);
fillCircle(70, 56, 22, ...cloud);
fillCircle(90, 66, 16, ...cloud);
fillRect(40, 62, 90, 80, ...cloud);

// Cloud bottom edge rounded
fillRoundRect(36, 70, 94, 82, 6, ...cloud);

// "%" glyph (dark, on cloud)
const glyph = [30, 30, 34];
// Diagonal bar
for (let i = 0; i < 28; i++) {
  const cx = 56 + i;
  const cy = 74 - i;
  for (let r = 0; r < 2; r++) {
    setPx(cx, cy + r, ...glyph);
  }
}
// Two circles of the percent sign
fillCircle(58, 80, 5, ...glyph);
fillCircle(80, 62, 5, ...glyph);

// PNG encoding
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
// compression, filter, interlace all 0

const rawRows = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  rawRows[y * (W * 4 + 1)] = 0; // filter: none
  px.copy(rawRows, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(rawRows, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "media");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon.png"), png);
console.log("icon.png written:", path.join(out, "icon.png"));