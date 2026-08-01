// Conversation store + short-term memory window. Mirrors sigma-agent-server's
// chat_memory / chat_messages tables (header + ordered messages, last-N window)
// over localStorage: this deployment has no server DB and only text may leave
// the device, so chats persist per-browser and the window travels per request.
import { Step } from "./api";

export type ChatRole = "self" | "other";
export type ChatMessage = { id: number; role: ChatRole; content: string; steps?: Step[] };
export type Conversation = { id: string; title: string; seq: number };
export type WireMessage = { role: ChatRole; content: string };

export const MEMORY_WINDOW = 10;

const CHATS_KEY = "chaplin_chats";

type StoredConversation = Conversation & { nextMsgId: number; messages: ChatMessage[] };
type Store = { seq: number; conversations: Record<string, StoredConversation> };

function load(): Store {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* corrupted or unavailable storage -> start fresh */
  }
  return { seq: 0, conversations: {} };
}

function save(store: Store): void {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(store));
  } catch {
    /* private mode / quota: chat degrades to in-memory-only for this call */
  }
}

function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// first ~4 words of the first message, like sigma's provisional title
export function provisionalTitle(content: string): string {
  const words = content.trim().split(/\s+/).slice(0, 4).join(" ");
  return words ? (words.length > 40 ? words.slice(0, 40) + "…" : words) : "New chat";
}

export function createConversation(firstContent?: string): Conversation {
  const store = load();
  store.seq += 1;
  const conv: StoredConversation = {
    id: uuid(),
    title: firstContent ? provisionalTitle(firstContent) : "New chat",
    seq: store.seq,
    nextMsgId: 1,
    messages: [],
  };
  store.conversations[conv.id] = conv;
  save(store);
  return { id: conv.id, title: conv.title, seq: conv.seq };
}

export function listConversations(): Conversation[] {
  const store = load();
  return Object.values(store.conversations)
    .map(({ id, title, seq }) => ({ id, title, seq }))
    .sort((a, b) => b.seq - a.seq);
}

export function getMessages(conversationId: string): ChatMessage[] {
  return load().conversations[conversationId]?.messages ?? [];
}

export function appendMessage(
  conversationId: string,
  role: ChatRole,
  content: string,
  steps?: Step[]
): ChatMessage | null {
  const store = load();
  const conv = store.conversations[conversationId];
  if (!conv) return null;
  const msg: ChatMessage = { id: conv.nextMsgId++, role, content, ...(steps ? { steps } : {}) };
  conv.messages.push(msg);
  if (conv.title === "New chat" && conv.messages.length === 1) {
    conv.title = provisionalTitle(content);
  }
  save(store);
  return msg;
}

export function deleteConversation(conversationId: string): void {
  const store = load();
  delete store.conversations[conversationId];
  save(store);
}

// the short-term memory sent to the agent: last N messages, wire shape only
export function historyWindow(conversationId: string): WireMessage[] {
  return getMessages(conversationId)
    .slice(-MEMORY_WINDOW)
    .map(({ role, content }) => ({ role, content }));
}
