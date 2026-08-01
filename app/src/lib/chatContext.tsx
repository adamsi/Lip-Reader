// Shared active-chat state so Run Agent and the Talk screen use the same chat.
import { createContext, useCallback, useContext, useState } from "react";

type ChatContextValue = {
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  version: number; // bumped after store writes so readers re-render
  touch: () => void;
};

const ChatContext = createContext<ChatContextValue>({
  activeChatId: null,
  setActiveChatId: () => {},
  version: 0,
  touch: () => {},
});

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const touch = useCallback(() => setVersion((v) => v + 1), []);
  return (
    <ChatContext.Provider value={{ activeChatId, setActiveChatId, version, touch }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  return useContext(ChatContext);
}
