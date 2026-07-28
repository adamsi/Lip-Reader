const VOICE_KEY = "chaplin_voice_id";

export const DEFAULT_VOICE_ID = "Brian";

export function getStoredVoiceId(): string {
  return localStorage.getItem(VOICE_KEY) || DEFAULT_VOICE_ID;
}

export function setStoredVoiceId(voiceId: string): void {
  localStorage.setItem(VOICE_KEY, voiceId);
}
