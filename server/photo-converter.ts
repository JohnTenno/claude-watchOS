import { execFile } from "node:child_process";
import { openSync, readSync, closeSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ImageMagick 6 (`convert`) as on Ubuntu; set IMAGEMAGICK=magick for ImageMagick 7.
const IMAGEMAGICK = process.env.IMAGEMAGICK ?? "convert";
// From libheif-examples/heif-thumbnailer: reads the small preview stored inside an iPhone HEIC.
const HEIF_THUMBNAILER = process.env.HEIF_THUMBNAILER ?? "heif-thumbnailer";
const TIMEOUT_MS = 60_000;
const THUMB_PX = 200;
const MAX_CACHED_THUMBNAILS = 200;

/** Turns the iPhone's original photos (HEIC, JPEG, PNG…) into JPEGs Claude and the watch can use. */
export class PhotoConverter {
  // One conversion at a time: decoding a 12 MP photo takes ~150 MB, and the watch asks for a whole grid at once.
  private queue: Promise<unknown> = Promise.resolve();
  // Keyed by path + mtime, so a replaced file never serves a stale preview.
  private readonly thumbnails = new Map<string, Buffer>();

  /** Small preview for the watch's photo grid. */
  thumbnail(path: string): Promise<Buffer> {
    const key = `${path}@${statSync(path).mtimeMs}`;
    const cached = this.thumbnails.get(key);
    if (cached) return Promise.resolve(cached);
    return this.serialized(async () => {
      const jpeg = PhotoConverter.isHeic(path) ? await this.heicThumbnail(path) : await this.toJpeg(path, ["-thumbnail", `${THUMB_PX}x${THUMB_PX}>`, "-quality", "70"]);
      if (this.thumbnails.size >= MAX_CACHED_THUMBNAILS) this.thumbnails.delete(this.thumbnails.keys().next().value!);
      this.thumbnails.set(key, jpeg);
      return jpeg;
    });
  }

  /** Version sent to Claude: the API rejects HEIC and images over ~5 MB, and gains nothing above 1568 px. */
  forClaude(path: string): Promise<Buffer> {
    return this.serialized(() => this.toJpeg(path, ["-resize", "1568x1568>", "-quality", "85"]));
  }

  /** ~40× faster and ~25× less memory than decoding the full HEIC; libheif falls back to decoding when there is no preview. */
  private async heicThumbnail(path: string): Promise<Buffer> {
    const png = join(tmpdir(), `thumb-${randomUUID()}.png`);
    try {
      await run(HEIF_THUMBNAILER, ["-s", String(THUMB_PX), path, png]);
      return await this.toJpeg(png, ["-quality", "70"]);
    } finally {
      rmSync(png, { force: true });
    }
  }

  private toJpeg(path: string, options: string[]): Promise<Buffer> {
    // [0]: first frame only; -auto-orient applies the photo's EXIF rotation before EXIF is stripped.
    return run(IMAGEMAGICK, [`${path}[0]`, "-auto-orient", "-strip", ...options, "jpeg:-"]);
  }

  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** HEIC/HEIF by content (ISO box "ftyp" + brand): Shortcut uploads have no extension. */
  private static isHeic(path: string): boolean {
    const header = Buffer.alloc(12);
    const fd = openSync(path, "r");
    try {
      readSync(fd, header, 0, 12, 0);
    } finally {
      closeSync(fd);
    }
    return header.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(header.subarray(8, 12).toString("latin1"));
  }
}

function run(cmd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS }, (error, stdout, stderr) =>
      error ? reject(new Error(`${cmd} failed: ${stderr.toString().trim() || error.message}`)) : resolve(stdout),
    );
  });
}
