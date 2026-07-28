import { useState } from "react";
import Onboarding from "./components/Onboarding";
import TalkScreen from "./components/TalkScreen";

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
