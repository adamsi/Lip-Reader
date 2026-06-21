import { useCallback, useEffect, useState } from "react";
import { SignedIn, SignedOut, SignIn, useAuth } from "@clerk/clerk-react";
import { getMe } from "./lib/api";
import Onboarding from "./components/Onboarding";
import TalkScreen from "./components/TalkScreen";
import Spinner from "./components/Spinner";

// Unauthenticated users land straight on the Clerk sign-in form (no
// intermediate buttons). The full wordmark sits above it as the brand moment.
function AuthScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-10">
      <img src="/chaplin_wordmark.png" alt="Chaplin AI" className="h-28 w-auto" />
      <SignIn
        appearance={{
          variables: { colorPrimary: "#6938ef", borderRadius: "0.75rem" },
          elements: { rootBox: "w-full flex justify-center" },
        }}
      />
    </div>
  );
}

function Home() {
  const { getToken, isLoaded } = useAuth();
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [changingVoice, setChangingVoice] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await getMe(getToken);
      setVoiceId(me.voice_id);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) refresh();
  }, [isLoaded, refresh]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }

  // Onboarding when no voice yet, or when the user asked to change it.
  if (!voiceId || changingVoice) {
    return (
      <Onboarding
        canCancel={Boolean(voiceId)}
        onCancel={() => setChangingVoice(false)}
        onDone={() => {
          setChangingVoice(false);
          refresh();
        }}
      />
    );
  }

  return <TalkScreen onChangeVoice={() => setChangingVoice(true)} />;
}

export default function App() {
  return (
    <>
      <SignedOut>
        <AuthScreen />
      </SignedOut>
      <SignedIn>
        <Home />
      </SignedIn>
    </>
  );
}
