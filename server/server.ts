// Relays chat messages from the watch app to headless Claude Code (`claude -p`),
// so replies run on the user's Claude subscription instead of API tokens.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { ClaudeCli } from "./claude-cli.ts";
import { ConversationStore } from "./conversation-store.ts";
import { UsageClient } from "./usage-client.ts";

const PORT = Number(process.env.PORT ?? 8787);
// 127.0.0.1 = only via Tailscale Funnel; HOST=0.0.0.0 also allows the home Wi-Fi.
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_BODY_BYTES = 16 * 1024;
const TOKEN = Buffer.from(readFileSync(new URL("./token.txt", import.meta.url), "utf8").trim());

const claude = new ClaudeCli();
const store = new ConversationStore();
const usage = new UsageClient(() => claude.renewToken());

function isAuthorized(req: IncomingMessage): boolean {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  return given.length === TOKEN.length && timingSafeEqual(given, TOKEN);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, payload: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { text, conversationId } = JSON.parse(await readBody(req)) as { text?: unknown; conversationId?: unknown };
  if (typeof text !== "string" || text.trim() === "") return send(res, 400, { error: "Missing text" });
  if (conversationId !== undefined && (typeof conversationId !== "string" || !ConversationStore.isValidId(conversationId))) {
    return send(res, 400, { error: "Invalid conversationId" });
  }
  const { reply, sessionId } = await claude.ask(text, conversationId);
  store.append(sessionId, conversationId, text, reply);
  send(res, 200, { reply, conversationId: sessionId });
}

createServer(async (req, res) => {
  if (!isAuthorized(req)) return send(res, 401, { error: "Unauthorized" });
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (req.method === "POST" && path === "/chat") return await handleChat(req, res);
    if (req.method === "GET" && path === "/usage") return send(res, 200, await usage.get());
    if (req.method === "GET" && path === "/conversations") return send(res, 200, store.list());
    const match = /^\/conversations\/([^/]+)$/.exec(path);
    if (req.method === "GET" && match) {
      const conversation = store.get(match[1]);
      return conversation ? send(res, 200, conversation) : send(res, 404, { error: "Not found" });
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(new Date().toISOString(), e);
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}).listen(PORT, HOST, () => console.log(`WatchChat server listening on http://${HOST}:${PORT}`));
