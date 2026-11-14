export const assistantName = "Tomo";
export const dictationConsentVersion = "whisper-dictation-v1";
export const dictationRecordingSuffix = ".kuvos-dictation.m4a";
export function isDictationRecording(name: string) {
  return /^recording-[0-9a-f-]+\.kuvos-dictation\.m4a$/i.test(name);
}
export function appendTranscript(draft: string, transcript: string) {
  const text = [draft.trim(), transcript.trim()].filter(Boolean).join(" ");
  if (!transcript.trim())
    throw new Error("No speech was recognised. Please record again.");
  if (text.length > 2000)
    throw new Error(
      "The transcript is too long for this message. Shorten your draft or record a shorter clip.",
    );
  return text;
}
export const emergencyHelp =
  "I can’t assess emergencies or give medical advice. Contact your healthcare provider now. If this may be an emergency, call your local emergency services. You can also call your caregiver.";
export type RhythmDay = {
  day: string;
  total: number;
  done: number;
  skipped: number;
  missed: number;
};
export type ChatLink = {
  label: string;
  kind: "task" | "plan" | "source" | "today" | "rhythm" | "exercise";
  id?: string;
  planId?: string;
  candidateId?: string;
  date?: string;
};
export type ChatTurn = {
  id: string;
  requestId: string;
  text: string;
  createdAt: string;
  reply: {
    text: string;
    kind: "answer" | "emergency" | "boundary";
    links: ChatLink[];
    tool?: string;
    chart?: { kind: "rhythm"; days: RhythmDay[] };
  };
};
export type ChatState = {
  patientName: string;
  turns: ChatTurn[];
  memories: { id: string; text: string; createdAt: string }[];
  contacts: { id: string; name: string; phone: string }[];
  externalAvailable: boolean;
  externalConsent: boolean;
  consentVersion: string;
  connectionStatus:
    "not_configured" | "awaiting_approval" | "consent_required" | "ready";
};
export function mergeTurn(turns: ChatTurn[], turn: ChatTurn) {
  return turns.some((item) => item.requestId === turn.requestId)
    ? turns
    : [...turns, turn];
}
