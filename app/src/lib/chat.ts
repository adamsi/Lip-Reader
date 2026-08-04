// Conversation store client. Chats persist in Supabase Postgres behind the
// API backend (/api/chats, sigma-agent-server's chat_memory / chat_messages
// shape); the short-term memory window is re-read per turn, like sigma's
// _load_history, and sent with each agent request.
import { API_BASE, Step, WireMessage } from "./api";

export type ChatRole = "self" | "other";
export type ChatMessage = { id: number; role: ChatRole; content: string; steps?: Step[] };
export type Conversation = { id: string; title: string; seq: number; isPreset: boolean };

export const MEMORY_WINDOW = 10;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const attempt = async (): Promise<T> => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json();
  };
  try {
    return await attempt();
  } catch (e) {
    // reads are safe to retry once (rides out serverless cold starts and
    // stale DB connections); mutations are not
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") throw e;
    await new Promise((r) => setTimeout(r, 800));
    return attempt();
  }
}

type ConversationWire = { id: string; title: string; seq: number; is_preset: boolean };

function fromWire(c: ConversationWire): Conversation {
  return { id: c.id, title: c.title, seq: c.seq, isPreset: c.is_preset };
}

export async function createConversation(): Promise<Conversation> {
  return fromWire(await request<ConversationWire>("/api/chats", { method: "POST", body: "{}" }));
}

// all conversations: seeded presets first (seed order), then user chats newest-first
export async function listConversations(): Promise<Conversation[]> {
  const data = await request<{ conversations: ConversationWire[] }>("/api/chats");
  return data.conversations.map(fromWire);
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  return (
    await request<{ messages: ChatMessage[] }>(`/api/chats/${conversationId}/messages`)
  ).messages;
}

export function appendMessage(
  conversationId: string,
  role: ChatRole,
  content: string,
  steps?: Step[]
): Promise<ChatMessage> {
  return request<ChatMessage>(`/api/chats/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(steps ? { role, content, steps } : { role, content }),
  });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await request(`/api/chats/${conversationId}`, { method: "DELETE" });
}

// the short-term memory sent to the agent: last N messages, wire shape only
export async function historyWindow(conversationId: string): Promise<WireMessage[]> {
  const messages = await getMessages(conversationId);
  return messages.slice(-MEMORY_WINDOW).map(({ role, content }) => ({ role, content }));
}
