// Relays chat messages from the watch app to headless Claude Code (`claude -p`),
// so replies run on the user's Claude subscription instead of API tokens.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ClaudeCli } from "./claude-cli.ts";
import { ConversationStore } from "./conversation-store.ts";
import { PhotoConverter } from "./photo-converter.ts";
import { PHONE_PHOTO_PREFIX, UploadJanitor } from "./upload-janitor.ts";
import { UsageClient } from "./usage-client.ts";

const PORT = Number(process.env.PORT ?? 8787);
// 127.0.0.1 = only via Tailscale Funnel; HOST=0.0.0.0 also allows the home Wi-Fi.
const HOST = process.env.HOST ?? "127.0.0.1";
const PHONE_PHOTO_ID_PATTERN = /^iphone-[0-9a-f]{16}$/;
const ICLOUD_FILE_PATTERN = /^[\w-]+\.(heic|jpe?g|png)$/i;
const MAX_GRID_PHOTOS = 20;
const TOKEN = Buffer.from(readFileSync(new URL("./token.txt", import.meta.url), "utf8").trim());

const claude = new ClaudeCli();
const store = new ConversationStore();
const uploads = new UploadJanitor(claude.workDir);
uploads.start();
const photos = new PhotoConverter();
const usage = new UsageClient(() => claude.renewToken());
// Warms the usage cache so the watch has a value even if its first request hits a network blip.
usage.get().catch((e) => console.error(new Date().toISOString(), "Usage warm-up failed:", e));

function isAuthorized(req: IncomingMessage): boolean {
  const given = Buffer.from((req.headers.authorization ?? "").replace(/^Bearer /, ""));
  return given.length === TOKEN.length && timingSafeEqual(given, TOKEN);
}

// No size limit by request: images can be any weight (only token holders can post).
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** JPEG, PNG or HEIC/HEIF (ISO box "ftyp" at byte 4): what the iPhone camera and screenshots produce. */
function isPhoto(body: Buffer): boolean {
  const jpeg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const png = body.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const heic = body.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(body.subarray(8, 12).toString("latin1"));
  return jpeg || png || heic;
}

/** Photos from the Shortcut (uploads/iphone-<hash>) and from iCloud Photos via icloudpd (icloud/<name>.HEIC…). */
function phonePhotoFiles(): { id: string; url: URL }[] {
  return [
    ...readdirSync(uploads.dir)
      .filter((f) => PHONE_PHOTO_ID_PATTERN.test(f))
      .map((f) => ({ id: f, url: new URL(f, uploads.dir) })),
    // Skips icloudpd's partial downloads and anything that is not a still photo.
    ...readdirSync(uploads.icloudDir)
      .filter((f) => ICLOUD_FILE_PATTERN.test(f))
      .map((f) => ({ id: `icloud-${f}`, url: new URL(f, uploads.icloudDir) })),
  ];
}

// Looked up among existing files, so a request can never name a path outside the photo folders.
function phonePhotoUrl(id: string): URL | undefined {
  return phonePhotoFiles().find((p) => p.id === id)?.url;
}

/** The iPhone Shortcut posts the original photo it just took as the raw body; it is kept as-is (format detected on read). */
async function handlePhotoUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(req);
  // The Shortcut sends {"photo": base64} so the body has a known length: raw file bodies from automations died
  // mid-upload at the Funnel (HTTP/2 PROTOCOL_ERROR). Raw bodies still work for manual runs and curl.
  const body = req.headers["content-type"]?.includes("application/json")
    ? Buffer.from(String((JSON.parse(raw.toString("utf8")) as { photo?: unknown }).photo ?? ""), "base64")
    : raw;
  if (!isPhoto(body)) {
    console.error(new Date().toISOString(), `Rejected iPhone photo: ${body.length} bytes, starts with ${body.subarray(0, 16).toString("hex")}`);
    return send(res, 400, { error: "Body must be a JPEG, PNG or HEIC photo" });
  }
  // Named by content hash: closing the Camera without a new shot re-sends the same photo, which is then skipped.
  const id = `${PHONE_PHOTO_PREFIX}${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
  const url = new URL(id, uploads.dir);
  if (existsSync(url)) return send(res, 200, { ok: true, duplicate: true });
  writeFileSync(url, body);
  console.log(new Date().toISOString(), `iPhone photo saved (${body.length} bytes)`);
  send(res, 200, { ok: true });
}

/** Newest iPhone photos taken today (server's local time), for the watch's photo grid (capped so it stays quick to scroll). */
function listPhonePhotos(): { id: string; takenAt: string }[] {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  return phonePhotoFiles()
    .map((p) => ({ id: p.id, mtime: statSync(p.url).mtime }))
    // Yesterday's files stay on disk until UploadJanitor's 24 h cutoff, so icloudpd's 1-day window never re-downloads them.
    .filter((p) => p.mtime.getTime() >= startOfToday)
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
    .slice(0, MAX_GRID_PHOTOS)
    .map((p) => ({ id: p.id, takenAt: p.mtime.toISOString() }));
}

function send(res: ServerResponse, status: number, payload: object): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { text, conversationId, photoId } = JSON.parse((await readBody(req)).toString("utf8")) as {
    text?: unknown; conversationId?: unknown; photoId?: unknown;
  };
  // The watch only names the iPhone photo; the original already lives on this host.
  const photoUrl = typeof photoId === "string" ? phonePhotoUrl(photoId) : undefined;
  if (photoId !== undefined && !photoUrl) return send(res, 400, { error: "Photo not found (iPhone photos are kept 1 day)" });
  if (typeof text !== "string" || (text.trim() === "" && !photoUrl)) return send(res, 400, { error: "Missing text" });
  if (conversationId !== undefined && (typeof conversationId !== "string" || !ConversationStore.isValidId(conversationId))) {
    return send(res, 400, { error: "Invalid conversationId" });
  }
  const image = photoUrl && (await photos.forClaude(fileURLToPath(photoUrl))).toString("base64");
  const { reply, sessionId } = await claude.ask(text.trim(), conversationId, image);
  store.append(sessionId, conversationId, image ? `📷 ${text.trim()}`.trim() : text, reply);
  send(res, 200, { reply, conversationId: sessionId });
}

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!isAuthorized(req)) {
    console.error(new Date().toISOString(), `401 ${req.method} ${path}`);
    return send(res, 401, { error: "Unauthorized" });
  }
  try {
    if (req.method === "POST" && path === "/chat") return await handleChat(req, res);
    if (req.method === "POST" && path === "/photos") return await handlePhotoUpload(req, res);
    if (req.method === "GET" && path === "/photos") return send(res, 200, listPhonePhotos());
    const photo = /^\/photos\/([^/]+)$/.exec(path);
    if (req.method === "GET" && photo) {
      const url = phonePhotoUrl(photo[1]);
      if (!url) return send(res, 404, { error: "Not found" });
      // A thumbnail, not the original: the watch only shows it in the grid. base64 so JSONDecoder reads it into Data.
      return send(res, 200, { thumbnail: (await photos.thumbnail(fileURLToPath(url))).toString("base64") });
    }
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
}).listen(PORT, HOST, () => console.log(`claude-watchOS relay listening on http://${HOST}:${PORT}`));
