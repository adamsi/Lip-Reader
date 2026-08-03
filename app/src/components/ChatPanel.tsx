import { useEffect, useState } from "react";
import {
  appendMessage,
  ChatMessage,
  Conversation,
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
} from "../lib/chat";
import { useChat } from "../lib/chatContext";
import Spinner from "./Spinner";
import StepsTrace from "./StepsTrace";

/**
 * Conversation picker + chat bubbles + "other person" input, shared by the
 * Run Agent panel and the Talk screen. Chats live in the Supabase-backed
 * /api/chats store; predictions are appended elsewhere (after a successful
 * agent run) as "self" messages.
 */
export default function ChatPanel() {
  const { activeChatId, setActiveChatId, version, touch } = useChat();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [otherText, setOtherText] = useState("");
  const [openStepsId, setOpenStepsId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [storeError, setStoreError] = useState(false);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    Promise.all([
      listConversations(),
      activeChatId ? getMessages(activeChatId) : Promise.resolve([]),
    ])
      .then(([convs, msgs]) => {
        if (stale) return;
        setConversations(convs);
        setMessages(msgs);
        setStoreError(false);
        // the active chat may have been deleted from another surface
        if (activeChatId && !convs.some((c) => c.id === activeChatId)) {
          setActiveChatId(null);
        }
      })
      .catch(() => !stale && setStoreError(true))
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, version]);

  async function withBusy(op: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await op();
      setStoreError(false);
    } catch {
      setStoreError(true);
    } finally {
      setBusy(false);
    }
  }

  const newChat = () =>
    withBusy(async () => {
      const conv = await createConversation();
      setActiveChatId(conv.id);
      touch();
    });

  const removeChat = () =>
    withBusy(async () => {
      if (!activeChatId) return;
      await deleteConversation(activeChatId);
      setActiveChatId(null);
      touch();
    });

  const addOther = () =>
    withBusy(async () => {
      const content = otherText.trim();
      if (!content || !activeChatId) return;
      await appendMessage(activeChatId, "other", content);
      setOtherText("");
      touch();
    });

  return (
    <div>
      {/* picker row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <select
            value={activeChatId ?? ""}
            onChange={(e) => setActiveChatId(e.target.value || null)}
            className="w-full appearance-none rounded-xl border border-sky-200 bg-white py-2.5 pl-3.5 pr-10 text-sm text-gray-900 outline-none focus:border-sky-500"
          >
            <option value="">No chat (single sentence)</option>
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400"
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <button
          onClick={newChat}
          disabled={busy}
          className="shrink-0 rounded-xl border border-sky-200 bg-white px-3 py-2.5 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-40"
        >
          + New chat
        </button>
        {activeChatId && (
          <button
            onClick={removeChat}
            disabled={busy}
            aria-label="Delete chat"
            className="shrink-0 rounded-xl border border-sky-200 bg-white px-2.5 py-2.5 text-gray-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {storeError && (
        <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          The chat store is unreachable right now — you can still correct single
          sentences below.
        </p>
      )}

      {activeChatId && !storeError && (
        <>
          {/* bubbles */}
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-2xl border border-sky-100 bg-white/70 p-3">
            {loading && messages.length === 0 && (
              <div className="flex justify-center py-2">
                <Spinner size={18} />
              </div>
            )}
            {!loading && messages.length === 0 && (
              <p className="py-2 text-center text-xs text-gray-400">
                Empty chat - add what the other person said, or send a prediction.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "self" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] ${m.role === "self" ? "text-right" : "text-left"}`}>
                  <div
                    className={`animate-pop inline-block rounded-2xl px-3.5 py-2 text-sm ${
                      m.role === "self"
                        ? "rounded-br-md bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                        : "rounded-bl-md border border-gray-200 bg-white text-gray-800"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === "self" && m.steps && m.steps.length > 0 && (
                    <button
                      onClick={() => setOpenStepsId(openStepsId === m.id ? null : m.id)}
                      className="mt-0.5 block w-full text-right text-[11px] font-medium text-violet-500 underline-offset-2 hover:underline"
                    >
                      {openStepsId === m.id ? "hide steps" : `steps (${m.steps.length})`}
                    </button>
                  )}
                  {m.role === "self" && m.steps && openStepsId === m.id && (
                    <div className="mt-1 text-left">
                      <StepsTrace steps={m.steps} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* other-character input */}
          <div className="mt-2 flex items-center gap-2">
            <input
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addOther()}
              placeholder="What did the other person say?"
              className="flex-1 rounded-xl border border-sky-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 outline-none focus:border-sky-500"
            />
            <button
              onClick={addOther}
              disabled={!otherText.trim() || busy}
              className="shrink-0 rounded-xl border border-sky-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-40"
            >
              {busy ? <Spinner size={16} /> : "Add"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const TrashIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
