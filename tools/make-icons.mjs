/*
 * AIEnabler - local export and clean-up tools for AI chat sites.
 * Copyright (C) 2026 David Cheng
 *
 * Free software under the GNU General Public License, version 3 or later.
 * Distributed with NO WARRANTY; see the LICENSE file in this repository or
 * <https://www.gnu.org/licenses/> for the full terms.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Draws the extension icon at every size Chrome asks for.
 *
 * The artwork is described once in a 128-unit square and rasterized per size,
 * rather than scaled down from one bitmap: a 16px icon made by shrinking a
 * large one turns to mush, while redrawing keeps every edge on whole pixels.
 * Detail is dropped as the canvas shrinks - sparkles and the dotted arc read as
 * dirt below 96px, and the "AI" lettering closes up below 32px - so each size
 * carries only what it can still show. Nothing is installed to run this: PNG is
 * written by hand on top of the zlib that ships with Node.
 *
 * Usage: node tools/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = [16, 48, 128];
const GRID = 128;
/** Subpixels per axis. Coverage from a hard in/out test is the anti-aliasing. */
const SAMPLES = 4;

const DEEP = [20, 88, 138];
const SHALLOW = [58, 143, 196];
const BUBBLE_TOP = [232, 244, 255];
const BUBBLE_BOTTOM = [47, 134, 240];
const MINT_TOP = [143, 240, 192];
const MINT_BOTTOM = [34, 201, 138];
const PAPER = [216, 230, 238];
const WHITE = [255, 255, 255];

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function mix(from, to, amount) {
  const t = clamp01(amount);
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

/** Lit from above, the way the reference art is. */
const radial = (from, to, cx, cy, radius) => (x, y) =>
  mix(from, to, Math.hypot(x - cx, y - cy) / radius);

const vertical = (from, to, y0, y1) => (_x, y) => mix(from, to, (y - y0) / (y1 - y0));

const flat = (color) => () => color;

// Signed distance fields: negative inside, zero on the edge. Outlines come from
// testing the distance against a stroke width, which is why every shape below
// returns a distance instead of a boolean.

const sdCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

function sdRoundedRect(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - halfW + r;
  const qy = Math.abs(y - cy) - halfH + r;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  );
}

function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp01((pax * bax + pay * bay) / (bax * bax + bay * bay));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function insideTriangle(x, y, ax, ay, bx, by, cx, cy) {
  const side = (x1, y1, x2, y2) => (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
  const d1 = side(ax, ay, bx, by);
  const d2 = side(bx, by, cx, cy);
  const d3 = side(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

const fill = (sdf) => (x, y) => sdf(x, y) <= 0;
const outline = (sdf, width) => (x, y) => Math.abs(sdf(x, y)) <= width / 2;
const bar = (ax, ay, bx, by, width) => (x, y) =>
  sdSegment(x, y, ax, ay, bx, by) <= width / 2;

/** A ray of the sparkle burst, measured out along an angle from a centre. */
function ray(cx, cy, degrees, from, to, width) {
  const radians = (degrees * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  return bar(cx + dx * from, cy + dy * from, cx + dx * to, cy + dy * to, width);
}

const LEFT = { cx: 52, cy: 52, halfW: 22, halfH: 22, r: 12 };
const RIGHT = { cx: 78, cy: 52, halfW: 22, halfH: 22, r: 12 };

const backdrop = () => ({
  test: fill((x, y) => sdCircle(x, y, 64, 64, 62)),
  color: radial(SHALLOW, DEEP, 56, 48, 96),
});

/**
 * Two outlined bubbles at 16px collapse into a smudge: the strokes, the gap
 * between them and the counters inside the lettering all land under one pixel
 * at once. The small icon keeps the same idea - an answer, leaving - as one
 * solid bubble and one solid arrow, which is all that survives at that size.
 */
function compactArtwork() {
  const bubble = (x, y) => sdRoundedRect(x, y, 62, 56, 40, 34, 14);
  return [
    backdrop(),
    {
      test: (x, y) =>
        fill(bubble)(x, y) || insideTriangle(x, y, 32, 78, 58, 78, 30, 104),
      color: vertical(BUBBLE_TOP, WHITE, 22, 90),
    },
    { test: bar(62, 76, 62, 52, 15), color: flat(MINT_BOTTOM) },
    {
      test: (x, y) => insideTriangle(x, y, 43, 56, 81, 56, 62, 32),
      color: flat(MINT_BOTTOM),
    },
  ];
}

/**
 * Layers painted back to front. The left bubble is filled with the background
 * before it is outlined, so the right bubble's edge disappears behind it and
 * the two read as one in front of the other rather than as a tangle.
 */
function artwork(size) {
  if (size < 32) return compactArtwork();
  const flourishes = size >= 96;
  const stroke = 5;
  const layers = [backdrop()];

  const rightBubble = (x, y) =>
    sdRoundedRect(x, y, RIGHT.cx, RIGHT.cy, RIGHT.halfW, RIGHT.halfH, RIGHT.r);
  layers.push({
    test: outline(rightBubble, stroke),
    color: vertical(MINT_TOP, MINT_BOTTOM, 30, 74),
  });

  // Export gesture: the arrow leaves the answer, the rule under it is the page.
  layers.push({
    test: bar(82, 62, 82, 46, stroke),
    color: vertical(MINT_TOP, MINT_BOTTOM, 38, 64),
  });
  layers.push({
    test: (x, y) => insideTriangle(x, y, 73, 48, 91, 48, 82, 36),
    color: flat(MINT_TOP),
  });
  layers.push({ test: bar(70, 66, 92, 66, stroke * 0.8), color: flat(PAPER) });

  const leftBubble = (x, y) =>
    sdRoundedRect(x, y, LEFT.cx, LEFT.cy, LEFT.halfW, LEFT.halfH, LEFT.r);
  const tail = (x, y) => insideTriangle(x, y, 36, 62, 54, 62, 34, 82);
  layers.push({
    test: (x, y) => fill(leftBubble)(x, y) || tail(x, y),
    color: radial(SHALLOW, DEEP, 56, 48, 96),
  });
  layers.push({
    test: (x, y) =>
      outline(leftBubble, stroke)(x, y) ||
      ((bar(36, 68, 34, 80, stroke)(x, y) || bar(34, 80, 48, 70, stroke)(x, y)) &&
        !fill(leftBubble)(x, y)),
    color: vertical(BUBBLE_TOP, BUBBLE_BOTTOM, 30, 82),
  });

  const pen = stroke * 0.85;
  layers.push({ test: bar(46, 45, 41, 61, pen), color: flat(WHITE) });
  layers.push({ test: bar(46, 45, 51, 61, pen), color: flat(WHITE) });
  layers.push({ test: bar(42, 56, 50, 56, pen * 0.75), color: flat(WHITE) });
  layers.push({ test: bar(59, 45, 59, 61, pen), color: flat(WHITE) });

  if (flourishes) {
    for (const angle of [190, 230, 270, 310, 350, 150]) {
      layers.push({ test: ray(50, 53, angle, 13, 17, 3), color: flat(MINT_TOP) });
    }
    layers.push({
      test: (x, y) =>
        Math.abs(sdCircle(x, y, 64, 152, 58)) <= 2 && y >= 92 && y <= 102,
      color: flat(PAPER),
    });
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        layers.push({
          test: fill((px, py) => sdCircle(px, py, 46 + column * 6, 104 + row * 6, 1.5)),
          color: flat(PAPER),
          alpha: 0.8 - row * 0.3,
        });
      }
    }
  }

  return layers;
}

/**
 * Renders to straight RGBA. Subsamples are composited premultiplied and only
 * divided out at the end, so a pixel half-covered by the circle's edge fades
 * cleanly instead of picking up a dark fringe from the transparent side.
 */
function render(size) {
  const layers = artwork(size);
  const pixels = Buffer.alloc(size * size * 4);
  const step = GRID / size / SAMPLES;
  const origin = step / 2;
  const total = SAMPLES * SAMPLES;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px * SAMPLES + sx) * step + origin;
          const y = (py * SAMPLES + sy) * step + origin;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;
          for (const layer of layers) {
            if (!layer.test(x, y)) continue;
            const [lr, lg, lb] = layer.color(x, y);
            const la = layer.alpha ?? 1;
            sr = lr * la + sr * (1 - la);
            sg = lg * la + sg * (1 - la);
            sb = lb * la + sb * (1 - la);
            sa = la + sa * (1 - la);
          }
          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }
      if (a === 0) continue;
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(r / a);
      pixels[offset + 1] = Math.round(g / a);
      pixels[offset + 2] = Math.round(b / a);
      pixels[offset + 3] = Math.round((a / total) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  // Every scanline carries filter 0: the images are tiny, so the predictors
  // would not earn their complexity here.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(iconsDir, { recursive: true });
for (const size of SIZES) {
  const file = join(iconsDir, `icon${size}.png`);
  writeFileSync(file, encodePng(size, render(size)));
  console.log(`wrote ${file}`);
}
