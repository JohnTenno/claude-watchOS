import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

export type Message = { role: "user" | "assistant"; text: string };
export type Conversation = { id: string; title: string; updatedAt: string; messages: Message[] };
export type ConversationSummary = Omit<Conversation, "messages">;

const TITLE_LENGTH = 40;
// Claude session ids are UUIDs; anything else is rejected so ids can never escape the history folder.
const ID_PATTERN = /^[0-9a-f-]{36}$/;

/** Keeps each conversation as a JSON file on the Mac, keyed by the Claude session id. */
export class ConversationStore {
  private readonly dir = new URL("./session/history/", import.meta.url);

  constructor() {
    mkdirSync(this.dir, { recursive: true });
  }

  static isValidId(id: string): boolean {
    return ID_PATTERN.test(id);
  }

  list(): ConversationSummary[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const { id, title, updatedAt } = this.read(f.slice(0, -5))!;
        return { id, title, updatedAt };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): Conversation | undefined {
    return ConversationStore.isValidId(id) ? this.read(id) : undefined;
  }

  /** Appends one exchange; `previousId` is the session the message continued (Claude may fork a new id). */
  append(id: string, previousId: string | undefined, user: string, assistant: string): void {
    const previous = previousId ? this.get(previousId) : undefined;
    const conversation: Conversation = this.get(id) ?? previous ?? {
      id,
      title: user.length > TITLE_LENGTH ? `${user.slice(0, TITLE_LENGTH)}…` : user,
      updatedAt: "",
      messages: [],
    };
    conversation.id = id;
    conversation.updatedAt = new Date().toISOString();
    conversation.messages.push({ role: "user", text: user }, { role: "assistant", text: assistant });
    writeFileSync(new URL(`${id}.json`, this.dir), JSON.stringify(conversation));
  }

  private read(id: string): Conversation | undefined {
    try {
      return JSON.parse(readFileSync(new URL(`${id}.json`, this.dir), "utf8")) as Conversation;
    } catch {
      return undefined;
    }
  }
}
