import assert from "node:assert/strict";
import {
  appendTranscript,
  isDictationRecording,
  mergeTurn,
  type ChatTurn,
} from "./chat.ts";
assert.equal(appendTranscript("Hello", " show my plan "), "Hello show my plan");
assert.equal(appendTranscript("", "Hello"), "Hello");
assert.throws(() => appendTranscript("Keep this draft", ""));
assert.throws(() =>
  appendTranscript("x".repeat(1995), "do not lose these words"),
);
assert(isDictationRecording("recording-1234-abcd.kuvos-dictation.m4a"));
assert(!isDictationRecording("recording-1234-abcd.m4a"));
assert(!isDictationRecording("care-document.pdf"));
const turn: ChatTurn = {
  id: "turn",
  requestId: "request",
  text: "Show today",
  createdAt: "2026-10-29T00:00:00Z",
  reply: { text: "Recorded day", kind: "answer", links: [] },
};
assert.equal(mergeTurn([], turn).length, 1);
const existing = [turn];
assert.equal(mergeTurn(existing, { ...turn, id: "retry" }), existing);
assert.equal(
  mergeTurn(existing, { ...turn, id: "next", requestId: "new" }).length,
  2,
);
console.log("Chat retry merge checks passed.");
