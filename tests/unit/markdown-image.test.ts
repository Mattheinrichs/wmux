import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_IMAGE_BYTES,
  bytesMatchExtension,
  readMarkdownImage,
  resolveImagePath,
  sniffImageType,
} from '../../src/main/markdown-image';

// Issue #380: local images in the markdown pane. The location is NOT the
// boundary (absolute paths are part of the feature); the file type is, plus
// the UNC rule, whose victim is the user's NTLM hash rather than the pixels.

const DOC = 'C:\\Users\\me\\notes\\README.md';

describe('resolveImagePath', () => {
  it('resolves a relative src against the document folder', () => {
    expect(resolveImagePath(DOC, 'img/a.png')).toEqual({ path: 'C:\\Users\\me\\notes\\img\\a.png' });
    expect(resolveImagePath(DOC, './a.png')).toEqual({ path: 'C:\\Users\\me\\notes\\a.png' });
  });

  it('follows .. — location is not the boundary, the type is', () => {
    expect(resolveImagePath(DOC, '../.ssh/id_rsa.png')).toEqual({ path: 'C:\\Users\\me\\.ssh\\id_rsa.png' });
  });

  it('percent-decodes and drops ?query / #fragment', () => {
    expect(resolveImagePath(DOC, 'my%20shot.png?raw=true')).toEqual({ path: 'C:\\Users\\me\\notes\\my shot.png' });
    expect(resolveImagePath(DOC, '100%.png')).toEqual({ path: 'C:\\Users\\me\\notes\\100%.png' });
  });

  it('accepts drive paths in either slash style', () => {
    expect(resolveImagePath(DOC, 'D:\\pics\\b.png')).toEqual({ path: 'D:\\pics\\b.png' });
    expect(resolveImagePath(DOC, 'D:/pics/b.png')).toEqual({ path: 'D:\\pics\\b.png' });
  });

  it('accepts file: URLs, including localhost', () => {
    expect(resolveImagePath(DOC, 'file:///C:/My%20Pics/c.png')).toEqual({ path: 'C:\\My Pics\\c.png' });
    expect(resolveImagePath(DOC, 'file://localhost/C:/c.png')).toEqual({ path: 'C:\\c.png' });
    expect(resolveImagePath(DOC, 'file:/C:/c.png')).toEqual({ path: 'C:\\c.png' });
  });

  it('allows absolute paths without a document, but not relative ones', () => {
    expect(resolveImagePath(null, 'C:\\shots\\s.png')).toEqual({ path: 'C:\\shots\\s.png' });
    expect(resolveImagePath(null, 'shot.png')).toMatchObject({ code: 'unsupported_path' });
  });

  it('refuses UNC, protocol-relative and file://host — an NTLM leak to whoever wrote the doc', () => {
    expect(resolveImagePath(DOC, '\\\\evil\\share\\x.png')).toMatchObject({ code: 'unc_refused' });
    expect(resolveImagePath(DOC, '//evil/share/x.png')).toMatchObject({ code: 'unc_refused' });
    expect(resolveImagePath(DOC, 'file://evil/share/x.png')).toMatchObject({ code: 'unc_refused' });
  });

  it('allows UNC only on the document\'s own share', () => {
    const uncDoc = '\\\\nas\\docs\\spec\\README.md';
    expect(resolveImagePath(uncDoc, 'img/a.png')).toEqual({ path: '\\\\nas\\docs\\spec\\img\\a.png' });
    expect(resolveImagePath(uncDoc, '\\\\NAS\\Docs\\other\\b.png')).toEqual({ path: '\\\\NAS\\Docs\\other\\b.png' });
    expect(resolveImagePath(uncDoc, '\\\\nas\\private\\b.png')).toMatchObject({ code: 'unc_refused' });
  });

  it('refuses device paths, root-relative, drive-relative and other schemes', () => {
    expect(resolveImagePath(DOC, '\\\\?\\C:\\x.png')).toMatchObject({ code: 'unc_refused' });
    expect(resolveImagePath(DOC, '\\\\.\\PhysicalDrive0')).toMatchObject({ code: 'unc_refused' });
    expect(resolveImagePath(DOC, '/images/x.png')).toMatchObject({ code: 'unsupported_path' });
    expect(resolveImagePath(DOC, 'C:x.png')).toMatchObject({ code: 'unsupported_path' });
    expect(resolveImagePath(DOC, 'https://e.org/x.png')).toMatchObject({ code: 'unsupported_path' });
    expect(resolveImagePath(DOC, '')).toMatchObject({ code: 'no_path' });
  });

  it('refuses a base that is not a markdown document', () => {
    expect(resolveImagePath('C:\\Users\\me\\x.exe', 'a.png')).toMatchObject({ code: 'unsupported_path' });
    expect(resolveImagePath('notes/README.md', 'a.png')).toMatchObject({ code: 'unsupported_path' });
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

describe('sniffImageType / bytesMatchExtension', () => {
  it('recognises every raster signature', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(Buffer.concat([Buffer.from('BM'), Buffer.alloc(30)]))).toBe('image/bmp');
    expect(sniffImageType(Buffer.from([0, 0, 1, 0, 1, 0, 0, 0]))).toBe('image/x-icon');
  });

  it('recognises an SVG after a prolog, and refuses a key file', () => {
    expect(sniffImageType(Buffer.from('\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<svg xmlns="x"></svg>'))).toBe('image/svg+xml');
    expect(sniffImageType(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn...'))).toBeNull();
    expect(sniffImageType(Buffer.concat([Buffer.from([0]), Buffer.from('<svg>')]))).toBeNull();
  });

  it('accepts a mislabelled raster but never crosses raster/SVG', () => {
    expect(bytesMatchExtension('.png', 'image/jpeg')).toBe(true);
    expect(bytesMatchExtension('.png', 'image/svg+xml')).toBe(false);
    expect(bytesMatchExtension('.svg', 'image/png')).toBe(false);
    expect(bytesMatchExtension('.svg', 'image/svg+xml')).toBe(true);
    expect(bytesMatchExtension('.png', null)).toBe(false);
    expect(bytesMatchExtension('.exe', 'image/png')).toBe(false);
  });
});

describe('readMarkdownImage', () => {
  let dir: string;
  let doc: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-mdimg-'));
    doc = path.join(dir, 'README.md');
    fs.writeFileSync(doc, '# doc');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns a data: URL typed by the bytes', async () => {
    fs.writeFileSync(path.join(dir, 'a.png'), JPEG);
    const res = await readMarkdownImage(doc, 'a.png');
    expect(res).toMatchObject({ dataUrl: `data:image/jpeg;base64,${JPEG.toString('base64')}` });
  });

  it('reads an SVG as an image/svg+xml data URL', async () => {
    fs.writeFileSync(path.join(dir, 'd.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await readMarkdownImage(doc, 'd.svg');
    expect('dataUrl' in res && res.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('refuses a non-image extension even with image bytes', async () => {
    fs.writeFileSync(path.join(dir, 'id_rsa'), PNG);
    expect(await readMarkdownImage(doc, 'id_rsa')).toMatchObject({ code: 'unsupported_type' });
  });

  it('refuses a renamed non-image (magic bytes)', async () => {
    fs.writeFileSync(path.join(dir, 'id_rsa.png'), '-----BEGIN OPENSSH PRIVATE KEY-----');
    expect(await readMarkdownImage(doc, 'id_rsa.png')).toMatchObject({ code: 'not_an_image' });
  });

  it('refuses a file over the size cap', async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PNG.copy(big);
    fs.writeFileSync(path.join(dir, 'big.png'), big);
    expect(await readMarkdownImage(doc, 'big.png')).toMatchObject({ code: 'too_large' });
  });

  it('refuses a missing file and a directory', async () => {
    expect(await readMarkdownImage(doc, 'nope.png')).toMatchObject({ code: 'not_found' });
    fs.mkdirSync(path.join(dir, 'dir.png'));
    expect(await readMarkdownImage(doc, 'dir.png')).toMatchObject({ code: 'not_regular_file' });
  });
});
