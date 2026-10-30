import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const TIMEOUT_MS = 300_000;
const TOKEN_RENEW_INTERVAL_MS = 10 * 60_000;
const SYSTEM_PROMPT =
  "You are Claude, a helpful assistant. The user is chatting from an Apple Watch. Keep answers short and plain (no tables, no code blocks unless asked). Reply in the user's language.";

export type ClaudeReply = { reply: string; sessionId: string };

/** Runs headless Claude Code (`claude -p`), which uses the user's subscription login. */
export class ClaudeCli {
  readonly workDir =new URL("./session/", import.meta.url).pathname;
  // Serializes calls so two requests never write to the same session at once.
  private queue: Promise<unknown> = Promise.resolve();
  private lastRenew = 0;

  constructor() {
    mkdirSync(this.workDir, { recursive: true });
  }

  ask(text: string, sessionId?: string, imageJpegBase64?: string): Promise<ClaudeReply> {
    const args = [
      "-p",
      "--tools", "", // chat only: no file, shell or web access on this Mac
      "--strict-mcp-config",
      "--setting-sources", "",
      // Replaces Claude Code's coding-agent prompt (memory, tools…) with a plain chat assistant.
      "--system-prompt", SYSTEM_PROMPT,
      // stream-json input is the only way to pass an image without enabling file tools.
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose", // required by -p with stream-json output
      ...(sessionId ? ["--resume", sessionId] : []),
    ];
    const content = [
      ...(imageJpegBase64 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageJpegBase64 } }] : []),
      ...(text ? [{ type: "text", text }] : []),
    ];
    const input = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n";
    const job = this.queue.then(async () => {
      // Prompt goes through stdin so text starting with "-" is never parsed as a flag.
      type ResultEvent = { type?: string; result?: string; session_id?: string; is_error?: boolean };
      const events = (await this.run(args, input)).split("\n").filter(Boolean).map((l) => JSON.parse(l) as ResultEvent);
      const result = events.find((e) => e.type === "result") ?? {};
      if (result.is_error || typeof result.result !== "string" || !result.session_id) {
        throw new Error(result.result || "Claude returned no reply");
      }
      return { reply: result.result.trim(), sessionId: result.session_id };
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Lets the CLI refresh its own OAuth token (same approach as TouchBarStats); at most once every 10 min. */
  async renewToken(): Promise<boolean> {
    if (Date.now() - this.lastRenew < TOKEN_RENEW_INTERVAL_MS) return false;
    this.lastRenew = Date.now();
    await this.run(["-p", "--model", "haiku", "--tools", "", "--strict-mcp-config"], "ok").catch(() => undefined);
    return true;
  }

  private run(args: string[], input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", args, { cwd: this.workDir, timeout: TIMEOUT_MS });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(out) : reject(new Error(err.trim() || out.trim() || `claude exited with ${code}`)),
      );
      child.stdin.end(input);
    });
  }
}
