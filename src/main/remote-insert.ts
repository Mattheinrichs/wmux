/**
 * remote-insert.ts — decide what text a paste or a drop puts into a terminal.
 *
 * Lives in main because every input to the decision does: the clipboard, the
 * ssh detector, the filesystem, scp, and the user config. The renderer used to
 * drive this and paid up to four IPC round trips per Ctrl+V transcribing main's
 * own data back to it — including one on every plain text paste that could
 * never succeed. It now asks one question and types the answer.
 *
 * The ssh session is passed in rather than looked up here, so this module never
 * has to import the detector that `ipc-handlers` owns.
 */

import { clipboard, type NativeImage } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { windowsTerminalQuote, posixShellQuote } from './shell-quote';
import { uploadFiles } from './remote-upload';
import { encodeBgraPng, fitImageSize } from './clipboard-image';
import type { DetectedSsh } from './ssh-argv';
import type { InsertionResult } from '../shared/types';

// Re-exported so callers and tests can name the contract from the module
// that produces it, while `shared/types` stays its single declaration.
export type { InsertionResult };


/**
 * Is upload switched on for this gesture?
 *
 * `[remote]` in `~/.wmux/config.toml`; both halves default to on, and the two
 * are independent — someone who disables it for paste keeps it for drop.
 * Takes the config section rather than reading it, so the mapping is testable
 * without a config file.
 */
export function uploadEnabled(
  remote: { uploadOnPaste?: boolean; uploadOnDrop?: boolean } | undefined,
  mode: 'paste' | 'drop',
): boolean {
  const toggle = mode === 'paste' ? remote?.uploadOnPaste : remote?.uploadOnDrop;
  return toggle !== false;
}

/** What a paste is made of, once the clipboard has been read. */
export type PasteSource =
  | { kind: 'files'; localPaths: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'none' };


/** Keep only absolute paths that still name regular files. */
export function regularFilePaths(candidates: unknown): string[] {
  if (!Array.isArray(candidates)) return [];
  return candidates.filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && path.isAbsolute(candidate) && isRegularFile(candidate),
  );
}

interface QueueEntry {
  tail: Promise<void>;
  pending: number;
  controller: AbortController;
}

/**
 * Serializes insertion resolution per surface while allowing unrelated panes
 * to proceed independently. Cancelling a surface prevents both queued and
 * already-resolved work from producing terminal text.
 */
export class SurfaceInsertionQueue {
  private readonly entries = new Map<string, QueueEntry>();

  enqueue(
    surfaceId: string,
    task: (signal: AbortSignal) => Promise<InsertionResult>,
  ): Promise<InsertionResult> {
    let entry = this.entries.get(surfaceId);
    if (!entry || entry.controller.signal.aborted) {
      entry = { tail: Promise.resolve(), pending: 0, controller: new AbortController() };
      this.entries.set(surfaceId, entry);
    }

    const queuedEntry = entry;
    queuedEntry.pending += 1;
    const result = queuedEntry.tail.then(async () => {
      if (queuedEntry.controller.signal.aborted) return { text: null };
      const resolved = await task(queuedEntry.controller.signal);
      return queuedEntry.controller.signal.aborted ? { text: null } : resolved;
    });
    queuedEntry.tail = result.then(
      () => undefined,
      () => undefined,
    );

    // `tail` never rejects (both handlers above resolve), so this cannot leak
    // an unhandled rejection.
    queuedEntry.tail.then(() => {
      queuedEntry.pending -= 1;
      if (queuedEntry.pending === 0 && this.entries.get(surfaceId) === queuedEntry) {
        this.entries.delete(surfaceId);
      }
    });
    return result;
  }

  cancel(surfaceId: string): void {
    const entry = this.entries.get(surfaceId);
    if (!entry) return;
    entry.controller.abort();
    this.entries.delete(surfaceId);
  }
}


/** Text for local paths — the behaviour a non-ssh pane has always had. */
export function localInsertionText(paths: string[]): string {
  return paths.map(windowsTerminalQuote).join(' ');
}

/** Text for paths on the far side of an ssh connection. */
export function remoteInsertionText(paths: string[]): string {
  return paths.map(posixShellQuote).join(' ');
}

/**
 * A pasted image, captured off the clipboard but not yet on disk (#381).
 *
 * `bitmap` is the normal case: Skia's BGRA pixels, copied synchronously so the
 * paste keeps its snapshot of the clipboard, and encoded later off the main
 * thread. `png` is the fallback for a bitmap whose length does not match its
 * size — Chromium's own encoder, the pre-#381 behaviour, rather than a guess.
 */
export type CapturedImage =
  | { kind: 'bitmap'; bitmap: Buffer; width: number; height: number }
  | { kind: 'png'; png: Buffer };

/**
 * What the clipboard held at the moment of the gesture. Everything but an
 * image is already a `PasteSource`; an image becomes one once it is written
 * (`materializeClipboard`).
 */
export type ClipboardSnapshot = PasteSource | { kind: 'image'; image: CapturedImage };

export interface ClipboardReadOptions {
  /**
   * Shrink an image to the largest size Claude Code would keep
   * (`[paste] downscale-images`, default true) — see `clipboard-image.ts`.
   */
  downscaleImages?: boolean;
}

/**
 * Read the clipboard into whatever the paste should be made of.
 *
 * Order matters. A screenshot is an image with no text, and a file copied in
 * Explorer is a *file reference* with neither an image nor text — which is why
 * checking only `readImage()` made that paste do nothing at all while dragging
 * the same file worked.
 *
 * Synchronous on purpose, image included: the caller snapshots the clipboard
 * BEFORE queueing, so a slow earlier upload cannot make this gesture paste
 * whatever is on the clipboard later. Only the encode and the write are
 * deferred, to `materializeClipboard`.
 */
export function readClipboardSource(options: ClipboardReadOptions = {}): ClipboardSnapshot {
  const image = clipboard.readImage();
  if (!image.isEmpty()) {
    return { kind: 'image', image: captureImage(image, options.downscaleImages !== false) };
  }

  // Explorer's Ctrl+C. Electron does not surface CF_HDROP on Windows — it
  // advertises `text/uri-list` and reads it back empty — so `FileNameW`, a
  // single-path format, is all that is reachable. Several files at once stay
  // the drag-and-drop route.
  const copied = clipboardFilePath();
  if (copied) return { kind: 'files', localPaths: [copied] };

  const text = clipboard.readText();
  return text ? { kind: 'text', text } : { kind: 'none' };
}

function captureImage(image: NativeImage, downscale: boolean): CapturedImage {
  const size = image.getSize(1);
  const target = downscale ? fitImageSize(size.width, size.height) : size;
  const scaled =
    target.width === size.width && target.height === size.height
      ? image
      : image.resize({ width: target.width, height: target.height, quality: 'good' });
  const actual = scaled.getSize(1);
  const bitmap = scaled.toBitmap({ scaleFactor: 1 });
  if (bitmap.length !== actual.width * actual.height * 4) return { kind: 'png', png: scaled.toPNG() };
  return { kind: 'bitmap', bitmap, width: actual.width, height: actual.height };
}

/**
 * Write a captured image to `%TEMP%/wmux` and answer with its path; anything
 * else passes through unchanged. Async end to end, so neither the encode nor
 * the write holds the main thread.
 */
export async function materializeClipboard(
  snapshot: ClipboardSnapshot,
  dir: string = path.join(os.tmpdir(), 'wmux'),
): Promise<PasteSource> {
  if (snapshot.kind !== 'image') return snapshot;
  const { image } = snapshot;
  const png =
    image.kind === 'bitmap' ? await encodeBgraPng(image.bitmap, image.width, image.height) : image.png;
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `screenshot-${Date.now()}.png`);
  await fs.promises.writeFile(file, png);
  return { kind: 'files', localPaths: [file] };
}

function clipboardFilePath(): string | null {
  let raw: Buffer;
  try {
    raw = clipboard.readBuffer('FileNameW');
  } catch {
    return null;
  }
  if (!raw || raw.length === 0) return null;
  const filePath = trimTrailingNuls(raw.toString('ucs2')).trim();
  return filePath && isRegularFile(filePath) ? filePath : null;
}

/** `FileNameW` is NUL-terminated (and may be padded); drop the terminators. */
function trimTrailingNuls(value: string): string {
  let end = value.length;
  while (end > 0 && value.codePointAt(end - 1) === 0) end--;
  return value.slice(0, end);
}

/**
 * Only regular files are uploadable — a directory is not something to hand scp,
 * and a clipboard entry can outlive the file it names. Anything else falls back
 * to inserting the local path, which is what cmux's `plan()` does too.
 */
function isRegularFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve the text to type.
 *
 * `session` is null for a local pane, which is also what a failed detection
 * looks like — either way the answer is the local path, which is merely the
 * old behaviour rather than something wrong.
 *
 * Pure: the clipboard read and the config lookup happen in the caller, which
 * is what lets the whole branch table be tested without an Electron window.
 */
export async function resolveInsertion(
  source: PasteSource,
  session: DetectedSsh | null,
  mayUpload: boolean,
  signal?: AbortSignal,
): Promise<InsertionResult> {
  if (signal?.aborted) return { text: null };
  if (source.kind === 'none') return { text: null };
  // Text is typed as-is: there is no file to put anywhere.
  if (source.kind === 'text') return { text: source.text };

  const localPaths = source.localPaths;
  if (localPaths.length === 0) return { text: null };

  // `mayUpload` already folds in the config toggle for this gesture and the
  // Shift modifier: both mean "give me the local path", and nothing here can
  // tell them apart or needs to. Anything that is not a regular file is not
  // uploadable either.
  if (!mayUpload || !session || !localPaths.every(isRegularFile)) {
    return { text: localInsertionText(localPaths) };
  }

  const outcome = await uploadFiles(session, localPaths, signal);
  if (signal?.aborted) return { text: null };
  if (!outcome.ok || outcome.remotePaths.length !== localPaths.length) {
    // Inserting the local path here would read as success while handing the
    // remote shell a path it cannot open.
    return {
      text: null,
      failure: { destination: session.destination, detail: outcome.error ?? 'unknown error' },
    };
  }
  return { text: remoteInsertionText(outcome.remotePaths) };
}
