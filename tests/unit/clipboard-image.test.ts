import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';

/**
 * Issue #381 — a pasted screenshot froze the window for ~0.8 s.
 *
 * Two halves. `fitImageSize` decides how many pixels are worth encoding at all
 * (Claude Code throws the rest away), and is checked against its definition
 * rather than against a copy of its loop. The encoder is checked by DECODING
 * what it wrote — signature, chunk CRCs, IHDR, and the inflated IDAT against
 * the pixels it was given — since a PNG that "looks written" but carries a bad
 * CRC is one most viewers silently refuse.
 */

const clipboardState = vi.hoisted(() => ({ image: null as unknown, text: '' }));
vi.mock('electron', () => ({
  clipboard: {
    readImage: () => clipboardState.image,
    readBuffer: () => Buffer.alloc(0),
    readText: () => clipboardState.text,
  },
}));

import {
  fitImageSize,
  imageTiles,
  encodeBgraPng,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_TILES,
} from '../../src/main/clipboard-image';
import { readClipboardSource, materializeClipboard } from '../../src/main/remote-insert';

const fits = (w: number, h: number) => Math.max(w, h) <= MAX_IMAGE_EDGE && imageTiles(w, h) <= MAX_IMAGE_TILES;

function checkFit(w: number, h: number): void {
  const out = fitImageSize(w, h);
  if (fits(w, h)) {
    expect(out).toEqual({ width: w, height: h });
    return;
  }
  expect(fits(out.width, out.height)).toBe(true);
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const outLong = w >= h ? out.width : out.height;
  const outShort = w >= h ? out.height : out.width;
  // Same aspect: the short edge is the long one scaled by the source ratio.
  expect(outShort).toBe(Math.max(1, Math.round((outLong * short) / long)));
  // Largest: one more pixel on the long edge no longer fits (or is capped).
  if (outLong < Math.min(long, MAX_IMAGE_EDGE)) {
    const next = outLong + 1;
    const nextShort = Math.max(1, Math.round((next * short) / long));
    expect(fits(next, nextShort)).toBe(false);
  }
}

describe('fitImageSize', () => {
  it('leaves an image that already fits untouched', () => {
    expect(fitImageSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(fitImageSize(1, 1)).toEqual({ width: 1, height: 1 });
    expect(fitImageSize(2576, 100)).toEqual({ width: 2576, height: 100 });
  });

  it('shrinks the screenshot from the report past the tile rounding', () => {
    // Scaling to the area bound alone gives 2559x1465 = 92x53 = 4876 tiles.
    expect(fitImageSize(3500, 2004)).toEqual({ width: 2543, height: 1456 });
    expect(fitImageSize(2004, 3500)).toEqual({ width: 1456, height: 2543 });
  });

  it('caps the long edge and the tile count', () => {
    expect(fitImageSize(3840, 2160)).toEqual({ width: 2576, height: 1449 });
    expect(imageTiles(2576, 1449)).toBe(MAX_IMAGE_TILES);
    expect(fitImageSize(2576, 2576)).toEqual({ width: 1932, height: 1932 });
  });

  it('never rounds a thin edge to zero', () => {
    expect(fitImageSize(20000, 1)).toEqual({ width: 2576, height: 1 });
    expect(fitImageSize(100, 20000)).toEqual({ width: 13, height: 2576 });
  });

  it('passes nonsense through rather than inventing a size', () => {
    expect(fitImageSize(0, 10)).toEqual({ width: 0, height: 10 });
    expect(fitImageSize(Number.NaN, 10)).toEqual({ width: Number.NaN, height: 10 });
  });

  it('holds its definition across a sweep of sizes', () => {
    const edges = [1, 2, 27, 28, 29, 500, 1000, 1932, 1933, 2047, 2548, 2575, 2576, 2577, 3000, 4096, 5120, 7680, 12000];
    for (const w of edges) for (const h of edges) checkFit(w, h);
    for (let w = 2400; w <= 4000; w += 37) for (let h = 1200; h <= 4000; h += 53) checkFit(w, h);
  });
});

interface DecodedPng {
  width: number;
  height: number;
  colourType: number;
  raw: Buffer;
}

function decodePng(png: Buffer): DecodedPng {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let offset = 8;
  const types: string[] = [];
  const idat: Buffer[] = [];
  let ihdr: Buffer | null = null;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    expect(crc).toBe(zlib.crc32(Buffer.concat([type, data])) >>> 0);
    types.push(type.toString('ascii'));
    if (type.toString('ascii') === 'IHDR') ihdr = data;
    if (type.toString('ascii') === 'IDAT') idat.push(data);
    offset += 12 + length;
  }
  expect(offset).toBe(png.length);
  expect(types[0]).toBe('IHDR');
  expect(types.at(-1)).toBe('IEND');
  if (!ihdr) throw new Error('no IHDR');
  expect(ihdr[8]).toBe(8);
  expect([ihdr[10], ihdr[11], ihdr[12]]).toEqual([0, 0, 0]);
  return {
    width: ihdr.readUInt32BE(0),
    height: ihdr.readUInt32BE(4),
    colourType: ihdr[9],
    raw: zlib.inflateSync(Buffer.concat(idat)),
  };
}

/** Skia-style BGRA bitmap from straight RGBA pixels, premultiplying. */
function bgra(pixels: Array<[number, number, number, number]>): Buffer {
  const out = Buffer.alloc(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    out[i * 4] = Math.round((b * a) / 255);
    out[i * 4 + 1] = Math.round((g * a) / 255);
    out[i * 4 + 2] = Math.round((r * a) / 255);
    out[i * 4 + 3] = a;
  });
  return out;
}

describe('encodeBgraPng', () => {
  it('writes an opaque bitmap as RGB, swapping BGRA to RGB per row', async () => {
    const pixels: Array<[number, number, number, number]> = [
      [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255],
      [10, 20, 30, 255], [200, 100, 50, 255], [1, 2, 3, 255],
    ];
    const decoded = decodePng(await encodeBgraPng(bgra(pixels), 3, 2));
    expect(decoded).toMatchObject({ width: 3, height: 2, colourType: 2 });
    expect(decoded.raw).toEqual(
      Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 10, 20, 30, 200, 100, 50, 1, 2, 3]),
    );
  });

  it('writes a translucent bitmap as straight-alpha RGBA', async () => {
    const pixels: Array<[number, number, number, number]> = [
      [255, 128, 0, 128], [0, 0, 0, 0], [40, 80, 120, 255],
    ];
    const decoded = decodePng(await encodeBgraPng(bgra(pixels), 1, 3));
    expect(decoded).toMatchObject({ width: 1, height: 3, colourType: 6 });
    const rows = [...decoded.raw];
    expect(rows.filter((_, i) => i % 5 === 0)).toEqual([0, 0, 0]);
    // Un-premultiplying is lossy by at most one step.
    const first = rows.slice(1, 5);
    expect(Math.abs(first[0] - 255)).toBeLessThanOrEqual(1);
    expect(Math.abs(first[1] - 128)).toBeLessThanOrEqual(1);
    expect(first.slice(2)).toEqual([0, 128]);
    expect(rows.slice(6, 10)).toEqual([0, 0, 0, 0]);
    expect(rows.slice(11, 15)).toEqual([40, 80, 120, 255]);
  });

  it('round-trips a larger bitmap byte for byte', async () => {
    const w = 97;
    const h = 61;
    const bitmap = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      bitmap[i * 4] = i & 0xff;
      bitmap[i * 4 + 1] = (i >> 3) & 0xff;
      bitmap[i * 4 + 2] = (i * 7) & 0xff;
      bitmap[i * 4 + 3] = 255;
    }
    const decoded = decodePng(await encodeBgraPng(bitmap, w, h));
    expect(decoded.raw.length).toBe(h * (w * 3 + 1));
    for (let y = 0; y < h; y++) {
      expect(decoded.raw[y * (w * 3 + 1)]).toBe(0);
      for (let x = 0; x < w; x++) {
        const src = (y * w + x) * 4;
        const dst = y * (w * 3 + 1) + 1 + x * 3;
        expect([decoded.raw[dst], decoded.raw[dst + 1], decoded.raw[dst + 2]]).toEqual([
          bitmap[src + 2], bitmap[src + 1], bitmap[src],
        ]);
      }
    }
  });

  it('refuses a bitmap whose length does not match its size', async () => {
    await expect(encodeBgraPng(Buffer.alloc(10), 2, 2)).rejects.toThrow(/expected 16/);
  });
});

/** Just enough of NativeImage for `readClipboardSource`. */
function fakeImage(width: number, height: number, opts: { badBitmap?: boolean } = {}) {
  const resize = vi.fn((size: { width: number; height: number }) => fakeImage(size.width, size.height));
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize,
    toBitmap: () => Buffer.alloc(opts.badBitmap ? 3 : width * height * 4, 255),
    toPNG: vi.fn(() => Buffer.from('chromium-png')),
  };
}

describe('readClipboardSource + materializeClipboard', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-381-'));
    clipboardState.text = '';
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('captures the image synchronously, downscaled, without encoding it', () => {
    const image = fakeImage(3500, 2004);
    clipboardState.image = image;
    const snapshot = readClipboardSource();
    expect(image.resize).toHaveBeenCalledWith({ width: 2543, height: 1456, quality: 'good' });
    expect(image.toPNG).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({ kind: 'image', image: { kind: 'bitmap', width: 2543, height: 1456 } });
  });

  it('keeps every pixel when the downscale is switched off', () => {
    const image = fakeImage(3500, 2004);
    clipboardState.image = image;
    const snapshot = readClipboardSource({ downscaleImages: false });
    expect(image.resize).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({ image: { kind: 'bitmap', width: 3500, height: 2004 } });
  });

  it('does not resize an image that already fits', () => {
    const image = fakeImage(1920, 1080);
    clipboardState.image = image;
    readClipboardSource();
    expect(image.resize).not.toHaveBeenCalled();
  });

  it('writes the captured image as a decodable PNG and answers with its path', async () => {
    clipboardState.image = fakeImage(40, 30);
    const source = await materializeClipboard(readClipboardSource(), dir);
    expect(source.kind).toBe('files');
    if (source.kind !== 'files') return;
    expect(source.localPaths).toHaveLength(1);
    expect(path.dirname(source.localPaths[0])).toBe(dir);
    const decoded = decodePng(fs.readFileSync(source.localPaths[0]));
    expect(decoded).toMatchObject({ width: 40, height: 30, colourType: 2 });
  });

  it("falls back to Chromium's encoder for a bitmap of the wrong length", async () => {
    const image = fakeImage(4, 4, { badBitmap: true });
    clipboardState.image = image;
    const source = await materializeClipboard(readClipboardSource(), dir);
    if (source.kind !== 'files') throw new Error('expected files');
    expect(fs.readFileSync(source.localPaths[0]).toString()).toBe('chromium-png');
  });

  it('passes a non-image snapshot through untouched', async () => {
    clipboardState.image = { isEmpty: () => true };
    clipboardState.text = 'hello';
    const snapshot = readClipboardSource();
    expect(await materializeClipboard(snapshot, dir)).toEqual({ kind: 'text', text: 'hello' });
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
