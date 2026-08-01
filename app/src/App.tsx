import { useState } from "react";
import Onboarding from "./components/Onboarding";
import TalkScreen from "./components/TalkScreen";
import { ChatProvider } from "./lib/chatContext";

export default function App() {
  const [changingVoice, setChangingVoice] = useState(false);

  if (changingVoice) {
    return (
      <Onboarding
        canCancel
        onCancel={() => setChangingVoice(false)}
        onDone={() => setChangingVoice(false)}
      />
    );
  }

  return (
    <ChatProvider>
      <TalkScreen onChangeVoice={() => setChangingVoice(true)} />
    </ChatProvider>
  );
}
