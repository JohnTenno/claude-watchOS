import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_AGE_MS = 2 * 24 * 60 * 60_000;
// Photos the iPhone uploads on its own (to pick from on the watch) live 1 day; ones sent in a chat keep MAX_AGE_MS.
export const PHONE_PHOTO_PREFIX = "iphone-";
export const PHONE_PHOTO_MAX_AGE_MS = 24 * 60 * 60_000;
const SWEEP_INTERVAL_MS = 60 * 60_000;
const REMOVED_IMAGE = { type: "text", text: "[image deleted after 2 days]" };

type ImageBlock = { type: "image"; source?: { data?: string } };
type TranscriptLine = { timestamp?: string };

/** Removes photos older than 2 days (iPhone uploads: 1 day): the saved file and the base64 copy inside Claude Code's session transcripts. */
export class UploadJanitor {
  readonly dir = new URL("./session/uploads/", import.meta.url);
  // Filled by icloudpd with recent iCloud Photos (see README); file mtimes are the photos' creation dates.
  readonly icloudDir = new URL("./session/icloud/", import.meta.url);
  // Claude Code keeps transcripts under ~/.claude/projects/<cwd with non-alphanumerics as "-">.
  private readonly transcriptDir: string;

  constructor(claudeWorkDir: string) {
    mkdirSync(this.dir, { recursive: true });
    mkdirSync(this.icloudDir, { recursive: true });
    this.transcriptDir = join(homedir(), ".claude", "projects", claudeWorkDir.replace(/\/$/, "").replace(/[^a-zA-Z0-9]/g, "-"));
  }

  start(): void {
    this.sweep();
    setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  sweep(now = Date.now()): void {
    for (const file of readdirSync(this.dir)) {
      const url = new URL(file, this.dir);
      const maxAge = file.startsWith(PHONE_PHOTO_PREFIX) ? PHONE_PHOTO_MAX_AGE_MS : MAX_AGE_MS;
      if (now - statSync(url).mtimeMs > maxAge) rmSync(url);
    }
    for (const file of readdirSync(this.icloudDir)) {
      const url = new URL(file, this.icloudDir);
      if (now - statSync(url).mtimeMs > PHONE_PHOTO_MAX_AGE_MS) rmSync(url, { recursive: true });
    }
    if (!existsSync(this.transcriptDir)) return;
    for (const file of readdirSync(this.transcriptDir).filter((f) => f.endsWith(".jsonl"))) {
      this.scrubTranscript(join(this.transcriptDir, file), now);
    }
  }

  private scrubTranscript(path: string, now: number): void {
    const original = readFileSync(path, "utf8");
    if (!original.includes('"type":"image"')) return;
    const lines = original.split("\n").map((raw) => (raw.includes('"type":"image"') ? (JSON.parse(raw) as TranscriptLine) : raw));
    // The same image is also copied into lines without a timestamp (api-request-blob), so age is decided per image data.
    // Written as !(age > max) so a line without a timestamp (NaN) never marks an image as expired.
    const expired = new Set<string>();
    for (const line of lines) {
      if (typeof line === "string" || !(now - Date.parse(line.timestamp ?? "") > MAX_AGE_MS)) continue;
      UploadJanitor.walk(line, (image) => void expired.add(image.source?.data ?? ""));
    }
    if (expired.size === 0) return;
    const scrubbed = lines
      .map((line) => {
        if (typeof line === "string") return line;
        UploadJanitor.walk(line, (image, replace) => expired.has(image.source?.data ?? "") && replace());
        return JSON.stringify(line);
      })
      .join("\n");
    if (scrubbed !== original) writeFileSync(path, scrubbed);
  }

  /** Calls `visit` for every image block nested anywhere in `node`; `replace` swaps it for a text placeholder. */
  private static walk(node: unknown, visit: (image: ImageBlock, replace: () => void) => void): void {
    if (!node || typeof node !== "object") return;
    const entries = Array.isArray(node) ? node.entries() : Object.entries(node);
    for (const [key, child] of entries) {
      if ((child as ImageBlock | null)?.type === "image") {
        visit(child as ImageBlock, () => ((node as Record<string | number, unknown>)[key] = REMOVED_IMAGE));
      } else {
        UploadJanitor.walk(child, visit);
      }
    }
  }
}
