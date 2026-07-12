import { useState } from "react";
import Onboarding from "./components/Onboarding";
import TalkScreen from "./components/TalkScreen";

// No auth and no onboarding gate: "/" is the recording screen. The voice
// defaults to Brian until the user picks one via "Change voice" (persisted
// in localStorage only).
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

  return <TalkScreen onChangeVoice={() => setChangingVoice(true)} />;
}
