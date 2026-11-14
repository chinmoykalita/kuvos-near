import { randomUUID } from "expo-crypto";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../api";
import { useCareSession } from "../care-session";
import {
  assistantName,
  emergencyHelp,
  mergeTurn,
  type ChatLink,
  type ChatState,
  type ChatTurn,
  type RhythmDay,
} from "../chat";
import { Button } from "../components/button";
import { ChatDictation } from "../components/chat-dictation";
import { ChatIntro } from "../components/chat-intro";
import { Sheet } from "../components/sheet";
import { Text, TextInput } from "../components/text";
import { Tomo as AssistantAvatar } from "../components/tomo";
import { colors } from "../theme";
import { dayTone, recordedOf, weekday } from "./rhythm-screen";

export function ChatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { me, membership } = useCareSession();
  const patientId = membership.patient.id;
  const [state, setState] = useState<ChatState>();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Shown in the conversation while it is being sent, like a messaging app.
  const [sent, setSent] = useState<string>();
  const [dictating, setDictating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [newMessage, setNewMessage] = useState(false);
  const list = useRef<FlatList<ChatTurn>>(null);
  const follow = useRef(true);
  const active = useRef(false);
  const pending = useRef<{ text: string; requestId: string } | undefined>(
    undefined,
  );
  const request = useRef<AbortController | undefined>(undefined);
  const sending = useRef(false);
  const patient = membership.patient;
  const ready = state?.connectionStatus === "ready";
  // The list is inverted (newest first) so it stays anchored to the composer, like a messaging app.
  const newestFirst = useMemo(
    () => [...(state?.turns ?? [])].reverse(),
    [state?.turns],
  );
  const firstName = /^Kuvos user$/.test(me.user.name)
    ? ""
    : (me.user.name.trim().split(/\s+/)[0] ?? "");

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const next = await api<ChatState>(`/patients/${patientId}/chat`, {
        signal,
      });
      if (active.current && !signal?.aborted) setState(next);
    },
    [patientId],
  );

  useFocusEffect(
    useCallback(() => {
      active.current = true;
      const controller = new AbortController();
      void refresh(controller.signal)
        .then(() => {
          if (!controller.signal.aborted) setError("");
        })
        .catch((caught) => {
          if (!controller.signal.aborted)
            setError(
              caught instanceof Error
                ? caught.message
                : "Could not load the conversation.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
      return () => {
        active.current = false;
        controller.abort();
        request.current?.abort();
      };
    }, [refresh]),
  );

  async function send(text = draft) {
    const trimmed = text.trim();
    if (!trimmed || sending.current || dictating || !state || !ready) return;
    const input =
      pending.current?.text === trimmed
        ? pending.current
        : { text: trimmed, requestId: randomUUID() };
    pending.current = input;
    sending.current = true;
    setBusy(true);
    setSent(trimmed);
    setDraft("");
    setError("");
    follow.current = true;
    setNewMessage(false);
    list.current?.scrollToOffset({ offset: 0, animated: true });
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const turn = await api<ChatTurn>(`/patients/${patientId}/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      if (!active.current || controller.signal.aborted) return;
      setState(
        (previous) =>
          previous && { ...previous, turns: mergeTurn(previous.turns, turn) },
      );
      pending.current = undefined;
      void refresh().catch(() => undefined);
    } catch (caught) {
      // Return the unsent text to the composer so the same request can be retried.
      setDraft(trimmed);
      // The 45-second timeout aborts the request; say so instead of "Could not reach".
      const reason = controller.signal.aborted
        ? `${assistantName} took too long to reply.`
        : caught instanceof Error
          ? caught.message
          : "Your message could not be sent.";
      if (active.current)
        setError(
          `${reason} Your text is here to edit or retry. For urgent help, use Get help.`,
        );
    } finally {
      clearTimeout(timeout);
      sending.current = false;
      setBusy(false);
      setSent(undefined);
    }
  }

  function openLink(link: ChatLink) {
    if (link.kind === "today") router.push("/today");
    if (link.kind === "rhythm") router.push("/rhythm");
    if (link.kind === "exercise" && link.id)
      router.push({ pathname: "/physio/[id]", params: { id: link.id } });
    if (link.kind === "plan" && link.id)
      router.push({ pathname: "/plan/[id]", params: { id: link.id } });
    if (link.kind === "task" && link.id && link.planId && link.date)
      router.push({
        pathname: "/task/[id]",
        params: { id: link.id, planId: link.planId, date: link.date },
      });
    if (link.kind === "source" && link.id && link.candidateId)
      router.push({
        pathname: "/source/[id]",
        params: { id: link.id, candidateId: link.candidateId },
      });
  }

  function callCaregiver(phone: string) {
    void Linking.openURL(`tel:${phone}`).catch(() => {
      setError(
        "This device could not start a call. Please use your phone to contact your caregiver.",
      );
      setSettingsError(
        "This device could not start a call. Please use your phone to contact your caregiver.",
      );
    });
  }

  async function forget(id: string) {
    if (settingsBusy) return;
    setSettingsBusy(true);
    setSettingsError("");
    try {
      await api(`/patients/${patientId}/chat/memories/${id}`, {
        method: "DELETE",
      });
      setState(
        (previous) =>
          previous && {
            ...previous,
            memories: previous.memories.filter((note) => note.id !== id),
          },
      );
    } catch {
      setSettingsError("Could not forget this note. Please try again.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function consent(accepted: boolean) {
    if (settingsBusy) return;
    setSettingsBusy(true);
    setSettingsError("");
    try {
      await api("/chat/consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted, version: state?.consentVersion }),
      });
      await refresh();
    } catch {
      setSettingsError("Could not save that choice. Please try again.");
    } finally {
      setSettingsBusy(false);
    }
  }

  function clearHistory() {
    Alert.alert(
      "Clear this conversation?",
      "Saved notes stay in Memory. This clears your chat history for this person.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setSettingsBusy(true);
              setSettingsError("");
              try {
                await api(`/patients/${patientId}/chat/messages`, {
                  method: "DELETE",
                });
                setState((previous) => previous && { ...previous, turns: [] });
                pending.current = undefined;
              } catch {
                setSettingsError(
                  "Could not clear the conversation. Please try again.",
                );
              } finally {
                setSettingsBusy(false);
              }
            })();
          },
        },
      ],
    );
  }

  const goToEnd = () => {
    follow.current = true;
    setNewMessage(false);
    list.current?.scrollToOffset({ offset: 0, animated: true });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cloud"
      style={{ paddingTop: insets.top }}
    >
      {loading && !state ? (
        <ActivityIndicator
          className="flex-1"
          accessibilityLabel="Loading conversation"
        />
      ) : !state ? (
        <View className="flex-1 justify-center gap-4 px-5">
          <Text accessibilityRole="alert" className="text-slate">
            {error || "Could not load your conversation."}
          </Text>
          <Button
            title="Try again"
            onPress={() => {
              setLoading(true);
              void refresh()
                .catch((caught) => setError(caught.message))
                .finally(() => setLoading(false));
            }}
          />
        </View>
      ) : (
        <>
          {!ready && (
            <View className="mx-5 gap-3 rounded-2xl bg-white p-4">
              <Text
                accessibilityRole="header"
                className="font-semibold text-deep-blue"
              >
                {state.connectionStatus === "consent_required"
                  ? "Before we chat"
                  : "AI chat is not connected yet"}
              </Text>
              <Text className="text-sm leading-5 text-slate">
                {state.connectionStatus === "consent_required"
                  ? "To reply, a NEAR AI Cloud model running inside a secure enclave (TEE) receives your name, care role, messages, recent conversation, confirmed plan, today’s records and saved notes. You can turn this off in Memory. Your care instructions stay unchanged."
                  : "Your care plan and Get help are still available. Chat will be available after the team activates the AI connection."}
              </Text>
              {state.connectionStatus === "consent_required" ? (
                <Button
                  title="Allow AI chat"
                  disabled={settingsBusy}
                  onPress={() => void consent(true)}
                />
              ) : (
                <Button
                  title="Check again"
                  variant="secondary"
                  disabled={settingsBusy}
                  onPress={() => {
                    void refresh().catch(() =>
                      setError(
                        "Could not check the chat connection. Please retry.",
                      ),
                    );
                  }}
                />
              )}
              {!!settingsError && (
                <Text accessibilityRole="alert" className="text-coral">
                  {settingsError}
                </Text>
              )}
            </View>
          )}
          {!state.turns.length && !sent ? (
            <View className="flex-1 items-center justify-center gap-4 px-4 py-8">
              <AssistantAvatar size={96} mood="hello" />
              <Text className="text-center font-serif text-2xl text-deep-blue">
                Say hello to {assistantName}
              </Text>
            </View>
          ) : (
            <FlatList
              ref={list}
              inverted
              data={newestFirst}
              keyExtractor={(turn) => turn.id}
              keyboardShouldPersistTaps="handled"
              // Inverted: paddingTop is the visual bottom, next to the composer.
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingTop: 20,
                paddingBottom: 12,
                gap: 20,
              }}
              onScroll={(event) => {
                follow.current = event.nativeEvent.contentOffset.y < 80;
                if (follow.current) setNewMessage(false);
              }}
              scrollEventThrottle={100}
              onContentSizeChange={() => {
                if (!follow.current) setNewMessage(true);
              }}
              ListHeaderComponent={
                sent ? (
                  <View className="gap-4">
                    <UserMessage text={sent} />
                    <View className="flex-row items-start gap-2">
                      <View className="pt-1">
                        <AssistantAvatar size={28} mood="thinking" />
                      </View>
                      <Text
                        accessibilityLiveRegion="polite"
                        className="min-w-0 flex-1 pt-1 text-base leading-6 text-slate"
                      >
                        Thinking…
                      </Text>
                    </View>
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <View className="gap-4">
                  <UserMessage text={item.text} />
                  {/* Tomo keeps its avatar column; replies are open text with no bubble, except the emergency card. */}
                  <View className="flex-row items-start gap-2">
                    <View className="pt-1">
                      <AssistantAvatar size={28} animate={false} />
                    </View>
                    <View
                      accessibilityLiveRegion="polite"
                      className={`min-w-0 flex-1 gap-3 ${item.reply.kind === "emergency" ? "rounded-3xl rounded-tl-lg bg-sun p-4" : "pt-1"}`}
                    >
                      <Text
                        selectable
                        accessibilityLabel={`${assistantName}: ${item.reply.text}`}
                        className="text-base leading-6 text-ink"
                      >
                        {item.reply.text}
                      </Text>
                      <Text className="text-xs text-slate">
                        {new Intl.DateTimeFormat("en", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.createdAt))}
                      </Text>
                      {item.reply.chart?.kind === "rhythm" && (
                        <RhythmStrip days={item.reply.chart.days} />
                      )}
                      {item.reply.links.map((link, index) => (
                        <Pressable
                          key={index}
                          accessibilityRole="button"
                          onPress={() => openLink(link)}
                          className="min-h-12 justify-center rounded-2xl bg-white px-3 py-2"
                        >
                          <Text className="text-sm font-semibold text-cobalt">
                            {link.label} ›
                          </Text>
                        </Pressable>
                      ))}
                      {item.reply.kind === "emergency" &&
                        state.contacts.map((contact) => (
                          <Button
                            key={contact.id}
                            title={`Call ${contact.name || "caregiver"}`}
                            onPress={() => callCaregiver(contact.phone)}
                          />
                        ))}
                      {item.reply.kind !== "answer" && (
                        <Button
                          title="Contact options"
                          variant="secondary"
                          onPress={() => setHelpOpen(true)}
                        />
                      )}
                    </View>
                  </View>
                </View>
              )}
            />
          )}
          {newMessage && (
            <Button
              title="New message ↓"
              variant="secondary"
              size="compact"
              onPress={goToEnd}
            />
          )}
        </>
      )}
      <View className="gap-3 border-t border-line bg-white px-4 pb-3 pt-3">
        {!!error && !!state && (
          <Text
            selectable
            accessibilityRole="alert"
            className="text-sm text-coral"
          >
            {error}
          </Text>
        )}
        <View className="flex-row items-end gap-2">
          <TextInput
            accessibilityLabel={`Message ${assistantName}`}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={2000}
            editable={!busy && !dictating && ready}
            placeholder={dictating ? "Listening…" : `Message ${assistantName}…`}
            placeholderTextColor={colors.slate}
            className="min-h-12 min-w-0 flex-1 rounded-2xl bg-cloud px-4 py-3 text-base text-ink"
            style={{ maxHeight: 120 }}
          />
          <ChatDictation
            patientId={patientId}
            value={draft}
            onChange={setDraft}
            onError={setError}
            onActiveChange={setDictating}
            disabled={busy || memoryOpen || helpOpen || !ready}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={busy || dictating || !draft.trim() || !ready}
            accessibilityState={{
              disabled: busy || dictating || !draft.trim() || !ready,
            }}
            onPress={() => void send()}
            className={`min-h-12 min-w-12 items-center justify-center rounded-2xl ${busy || dictating || !draft.trim() || !ready ? "bg-line" : "bg-cobalt"}`}
          >
            <Text className="text-xl text-white">↑</Text>
          </Pressable>
        </View>
        <Text className="text-center text-xs leading-4 text-slate">
          AI can be wrong. No medical advice.
        </Text>
      </View>
      <ChatIntro name={firstName} />
      <Sheet visible={helpOpen} onClose={() => setHelpOpen(false)}>
        <Text
          accessibilityRole="header"
          className="font-serif text-2xl text-deep-blue"
        >
          Contact someone who can help
        </Text>
        <Text selectable className="text-base leading-6 text-ink">
          {emergencyHelp}
        </Text>
        {state?.contacts.map((contact) => (
          <Button
            key={contact.id}
            title={`Call ${contact.name || "caregiver"}`}
            onPress={() => callCaregiver(contact.phone)}
          />
        ))}
        {!state?.contacts.length && (
          <Text className="text-sm leading-5 text-slate">
            No verified caregiver phone number is available here. Contact your
            healthcare provider or caregiver using your phone.
          </Text>
        )}
        {!!settingsError && (
          <Text accessibilityRole="alert" className="text-coral">
            {settingsError}
          </Text>
        )}
        <Button
          title="Close"
          variant="secondary"
          onPress={() => setHelpOpen(false)}
        />
      </Sheet>
      <Sheet visible={memoryOpen} onClose={() => setMemoryOpen(false)}>
        <Text
          accessibilityRole="header"
          className="font-serif text-2xl text-deep-blue"
        >
          What you’ve saved
        </Text>
        <Text className="text-sm leading-5 text-slate">
          Private to you, for {state?.patientName ?? patient?.name}. Saved only
          when you ask. Notes never change the care plan.
        </Text>
        {state?.memories.map((note) => (
          <View key={note.id} className="gap-2 border-b border-line pb-3">
            <Text selectable className="text-base text-ink">
              {note.text}
            </Text>
            <Text className="text-xs text-slate">
              You told me · {new Date(note.createdAt).toLocaleDateString()}
            </Text>
            <Button
              title="Forget"
              variant="secondary"
              size="compact"
              disabled={settingsBusy}
              onPress={() => void forget(note.id)}
            />
          </View>
        ))}
        {!state?.memories.length && (
          <Text className="text-slate">Nothing saved yet.</Text>
        )}
        <Button
          title="Add a note"
          disabled={busy || !state || !ready}
          onPress={() => {
            setDraft("Remember that ");
            setMemoryOpen(false);
          }}
        />
        <Text className="text-xs leading-5 text-slate">
          Forgetting removes the note from active memory. Conversation history
          is separate; clear it below to remove the original message too.
        </Text>
        {(state?.externalAvailable || state?.externalConsent) && (
          <View className="gap-3 rounded-2xl bg-cloud p-4">
            <Text className="font-semibold text-ink">AI chat privacy</Text>
            <Text className="text-sm leading-5 text-slate">
              To reply, a NEAR AI Cloud model running inside a secure enclave
              (TEE) receives your name, care role, messages, recent conversation, confirmed
              care records and saved notes. Turn this off to stop new AI chat
              requests.
            </Text>
            <Button
              title={
                state.externalConsent ? "Turn off AI chat" : "Allow AI chat"
              }
              variant="secondary"
              disabled={settingsBusy}
              onPress={() => void consent(!state.externalConsent)}
            />
          </View>
        )}
        <Button
          title="Clear conversation"
          variant="secondary"
          disabled={busy || settingsBusy || !state}
          onPress={clearHistory}
        />
        {!!settingsError && (
          <Text accessibilityRole="alert" className="text-coral">
            {settingsError}
          </Text>
        )}
        <Button
          title="Close"
          variant="secondary"
          onPress={() => setMemoryOpen(false)}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <View className="max-w-[90%] self-end rounded-3xl rounded-br-lg bg-deep-blue px-4 py-3">
      <Text selectable className="text-base leading-6 text-white">
        {text}
      </Text>
    </View>
  );
}

// Seven days of recorded check-ins, in the same tones as the Rhythm tab.
function RhythmStrip({ days }: { days: RhythmDay[] }) {
  return (
    <View className="flex-row gap-1.5 rounded-2xl bg-white p-2">
      {days.map((day) => {
        const tone = dayTone(day);
        return (
          <View
            key={day.day}
            accessible
            accessibilityLabel={`${day.day}: ${tone.label}${day.total ? `, ${recordedOf(day)} of ${day.total} recorded` : ""}`}
            className="flex-1 items-center gap-1"
          >
            <Text className="text-2xs font-bold uppercase text-slate">
              {weekday(day.day)}
            </Text>
            <View
              className={`h-8 w-full items-center justify-center rounded-lg ${tone.cell}`}
            >
              <Text className={`text-xs ${tone.text}`}>
                {Number(day.day.slice(-2))}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
