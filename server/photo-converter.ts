import { execFile } from "node:child_process";

// ImageMagick 6 (`convert`) as on Ubuntu; set IMAGEMAGICK=magick for ImageMagick 7.
const IMAGEMAGICK = process.env.IMAGEMAGICK ?? "convert";
const TIMEOUT_MS = 60_000;

/** Turns the iPhone's original photos (HEIC, JPEG, PNG…) into JPEGs Claude and the watch can use. */
export class PhotoConverter {
  /** Small square-ish preview for the watch's photo grid. */
  thumbnail(path: string): Promise<Buffer> {
    return this.toJpeg(path, ["-thumbnail", "200x200>", "-quality", "70"]);
  }

  /** Version sent to Claude: the API rejects HEIC and images over ~5 MB, and gains nothing above 1568 px. */
  forClaude(path: string): Promise<Buffer> {
    return this.toJpeg(path, ["-resize", "1568x1568>", "-quality", "85"]);
  }

  private toJpeg(path: string, options: string[]): Promise<Buffer> {
    // [0]: first frame only; -auto-orient applies the photo's EXIF rotation before EXIF is stripped.
    const args = [`${path}[0]`, "-auto-orient", "-strip", ...options, "jpeg:-"];
    return new Promise((resolve, reject) => {
      execFile(IMAGEMAGICK, args, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT_MS }, (error, stdout, stderr) =>
        error ? reject(new Error(`${IMAGEMAGICK} failed: ${stderr.toString().trim() || error.message}`)) : resolve(stdout),
      );
    });
  }
}
