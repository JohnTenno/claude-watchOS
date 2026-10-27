import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";

const ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CACHE_MS = 60_000;

export type UsageWindow = { usedPercent: number; resetsAt: string | null };
export type Usage = { session: UsageWindow | null; weekly: UsageWindow | null };

type RawWindow = { utilization?: number; resets_at?: string } | null | undefined;

/**
 * Reads the subscription limits with Claude Code's own OAuth login (same approach as TouchBarStats).
 * Never refreshes or writes credentials itself: on 401 it asks `renewToken` to let the CLI do it.
 */
export class UsageClient {
  private cached?: { at: number; usage: Usage };
  private readonly renewToken: () => Promise<boolean>;

  constructor(renewToken: () => Promise<boolean>) {
    this.renewToken = renewToken;
  }

  async get(): Promise<Usage> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.usage;
    let response = await this.request();
    if ((response.status === 401 || response.status === 403) && (await this.renewToken())) {
      response = await this.request();
    }
    if (!response.ok) throw new Error(`Usage request failed (${response.status})`);
    const body = (await response.json()) as { five_hour?: RawWindow; seven_day?: RawWindow };
    const usage = { session: toWindow(body.five_hour), weekly: toWindow(body.seven_day) };
    this.cached = { at: Date.now(), usage };
    return usage;
  }

  private async request(): Promise<Response> {
    return fetch(ENDPOINT, {
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  }
}

function toWindow(raw: RawWindow): UsageWindow | null {
  // Normalized to millisecond ISO dates, which Swift's ISO8601DateFormatter can parse.
  const resetsAt = raw?.resets_at ? new Date(raw.resets_at).toISOString() : null;
  return raw ? { usedPercent: raw.utilization ?? 0, resetsAt } : null;
}

async function accessToken(): Promise<string> {
  const json = await readFile(`${homedir()}/.claude/.credentials.json`, "utf8").catch(async () => {
    // `security` reuses the Keychain permission Claude Code already has.
    const { stdout } = await promisify(execFile)("/usr/bin/security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"]);
    return stdout;
  });
  const token = (JSON.parse(json) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken;
  if (!token) throw new Error("Claude Code is not logged in");
  return token;
}
