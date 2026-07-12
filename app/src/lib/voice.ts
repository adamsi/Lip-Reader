// The selected voice persists locally on this device only (no accounts, no DB).
const VOICE_KEY = "chaplin_voice_id";

// Used until the user picks a voice via "Change voice".
export const DEFAULT_VOICE_ID = "Brian";

export function getStoredVoiceId(): string {
  return localStorage.getItem(VOICE_KEY) || DEFAULT_VOICE_ID;
}

export function setStoredVoiceId(voiceId: string): void {
  localStorage.setItem(VOICE_KEY, voiceId);
}
