import { requireOptionalNativeModule } from "expo";
import { File } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Alert, AppState, Pressable } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { api } from "../api";
import {
  appendTranscript,
  dictationConsentVersion,
  dictationRecordingSuffix,
} from "../chat";
import {
  clearDictationRecordings,
  deleteDictationRecording,
} from "../dictation-cache";
import { colors } from "../theme";
import { Text } from "./text";

// A recording module cannot be added by OTA; older binaries must keep typing without crashing.
const audio = requireOptionalNativeModule("ExpoAudio")
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- Load only after the native compatibility check.
    (require("expo-audio") as typeof import("expo-audio"))
  : null;
type Props = {
  patientId: string;
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onActiveChange: (active: boolean) => void;
  disabled: boolean;
};
type Phase = "idle" | "starting" | "recording" | "transcribing" | "stopping";

function DictationButton({
  phase,
  disabled,
  onPress,
}: {
  phase: Phase;
  disabled: boolean;
  onPress: () => void;
}) {
  const waiting = phase !== "idle" && phase !== "recording";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        phase === "recording"
          ? "Stop recording and transcribe"
          : phase === "transcribing"
            ? "Transcribing recording"
            : "Record a message"
      }
      accessibilityState={{ disabled: disabled || waiting, busy: waiting }}
      disabled={disabled || waiting}
      onPress={onPress}
      className={`min-h-12 min-w-12 items-center justify-center rounded-2xl ${phase === "recording" ? "bg-sun" : "bg-cloud"}`}
    >
      {phase === "recording" ? (
        <Text className="text-sm font-semibold text-deep-blue">Stop</Text>
      ) : waiting ? (
        <ActivityIndicator size="small" color={colors.deepBlue} />
      ) : (
        <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
          <Rect
            x={9}
            y={2}
            width={6}
            height={12}
            rx={3}
            stroke={colors.deepBlue}
            strokeWidth={1.8}
            fill="none"
          />
          <Path
            d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"
            stroke={colors.deepBlue}
            strokeWidth={1.8}
            strokeLinecap="round"
            fill="none"
          />
        </Svg>
      )}
    </Pressable>
  );
}

export function ChatDictation(props: Props) {
  if (!audio)
    return (
      <DictationButton
        phase="idle"
        disabled={props.disabled}
        onPress={() =>
          props.onError(
            "Microphone recording needs the latest app build. You can still type.",
          )
        }
      />
    );
  return <RecordingDictation {...props} />;
}

function RecordingDictation({
  patientId,
  value,
  onChange,
  onError,
  onActiveChange,
  disabled,
}: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const currentPhase = useRef<Phase>("idle");
  const unavailable = useRef(disabled);
  useLayoutEffect(() => {
    unavailable.current = disabled;
  }, [disabled]);
  const focused = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const agreed = useRef(false);
  const draft = useRef("");
  const fileUri = useRef<string | null>(null);
  const upload = useRef<AbortController | null>(null);
  const work = useRef<Promise<void> | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopAction = useRef<() => void>(() => {});
  const cancelAction = useRef<() => Promise<void>>(async () => {});
  const recorder = audio!.useAudioRecorder(
    {
      ...audio!.RecordingPresets.HIGH_QUALITY,
      directory: "cache",
      extension: dictationRecordingSuffix,
    },
    (status) => {
      if (
        status.hasError &&
        currentPhase.current !== "idle" &&
        currentPhase.current !== "stopping"
      ) {
        onError("Recording stopped unexpectedly. Please type or record again.");
        void cancelAction.current();
      }
    },
  );

  const changePhase = useCallback(
    (next: Phase) => {
      currentPhase.current = next;
      if (mounted.current) {
        setPhase(next);
        onActiveChange(next !== "idle");
      }
    },
    [onActiveChange],
  );

  const cleanup = useCallback(async () => {
    if (limit.current) clearTimeout(limit.current);
    let uri = fileUri.current;
    try {
      uri ??= recorder.uri;
      if (recorder.isRecording) await recorder.stop();
    } finally {
      try {
        deleteDictationRecording(uri);
      } finally {
        fileUri.current = null;
        await audio!.setAudioModeAsync({ allowsRecording: false });
      }
    }
  }, [recorder]);

  const cancel = useCallback(async () => {
    if (currentPhase.current === "stopping") return;
    generation.current++;
    upload.current?.abort();
    if (limit.current) clearTimeout(limit.current);
    if (currentPhase.current === "idle") return;
    changePhase("stopping");
    try {
      await work.current;
      await cleanup();
    } catch {
      if (focused.current)
        onError(
          "Recording cleanup could not finish. Please restart the app before recording again.",
        );
    } finally {
      changePhase("idle");
    }
  }, [changePhase, cleanup, onError]);
  useEffect(() => {
    cancelAction.current = cancel;
  }, [cancel]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      try {
        clearDictationRecordings(recorder.uri);
      } catch {
        onError(
          "Could not remove a temporary recording. Please restart the app before recording again.",
        );
      }
      return () => {
        focused.current = false;
        void cancel();
      };
    }, [cancel, onError, recorder]),
  );
  // A recording must never carry over to another care subject.
  useEffect(() => {
    void cancel();
  }, [patientId, cancel]);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (
        state === "background" ||
        (state !== "active" &&
          (currentPhase.current === "recording" ||
            currentPhase.current === "transcribing"))
      )
        void cancel();
    });
    return () => {
      mounted.current = false;
      onActiveChange(false);
      subscription.remove();
    };
  }, [cancel, onActiveChange]);
  useEffect(() => {
    if (disabled) void cancel();
  }, [disabled, cancel]);

  async function start() {
    const token = ++generation.current;
    const valid = () =>
      focused.current && !unavailable.current && token === generation.current;
    changePhase("starting");
    onError("");
    draft.current = value;
    try {
      clearDictationRecordings(recorder.uri);
      const permission = await audio!.requestRecordingPermissionsAsync();
      if (!valid()) return;
      if (!permission.granted)
        throw new Error(
          "Microphone access is off. Enable it in Settings or type instead.",
        );
      await audio!.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      if (!valid()) return;
      await recorder.prepareToRecordAsync();
      fileUri.current = recorder.uri;
      if (!valid()) return;
      recorder.record({ forDuration: 60 });
      changePhase("recording");
      limit.current = setTimeout(() => {
        if (valid() && currentPhase.current === "recording")
          stopAction.current();
      }, 60_000);
    } catch (error) {
      if (valid())
        onError(
          error instanceof Error
            ? error.message
            : "Recording could not start. You can still type.",
        );
    } finally {
      if (currentPhase.current !== "recording" || !valid()) {
        try {
          await cleanup();
        } catch {
          if (focused.current)
            onError(
              "Recording cleanup could not finish. Please restart the app.",
            );
        }
        changePhase("idle");
      }
    }
  }

  async function finish() {
    const token = generation.current;
    const valid = () =>
      focused.current && !unavailable.current && token === generation.current;
    changePhase("transcribing");
    if (limit.current) clearTimeout(limit.current);
    const controller = new AbortController();
    upload.current = controller;
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      if (recorder.isRecording) await recorder.stop();
      if (!valid()) return;
      const uri = fileUri.current ?? recorder.uri;
      if (!uri)
        throw new Error("No recording was captured. Please record again.");
      const file = new File(uri);
      if (!file.exists || !file.size)
        throw new Error("No audio was captured. Please record again.");
      if (file.size > 2 * 1024 * 1024)
        throw new Error(
          "Recording is too large. Please record a shorter message.",
        );
      const form = new FormData();
      form.append("audio", file, "dictation.m4a");
      const result = await api<{ text: string }>(
        `/patients/${patientId}/chat/transcription`,
        {
          method: "POST",
          headers: { "X-Dictation-Consent": dictationConsentVersion },
          body: form,
          signal: controller.signal,
        },
      );
      if (valid() && !controller.signal.aborted)
        onChange(appendTranscript(draft.current, result.text));
    } catch (error) {
      if (valid())
        onError(
          error instanceof Error
            ? error.message
            : "Transcription failed. You can still type.",
        );
    } finally {
      clearTimeout(timeout);
      upload.current = null;
      try {
        await cleanup();
      } catch {
        if (focused.current)
          onError(
            "Recording cleanup could not finish. Please restart the app.",
          );
      }
      changePhase("idle");
    }
  }

  function launch(task: () => Promise<void>) {
    const promise = task();
    work.current = promise;
    void promise
      .finally(() => {
        if (work.current === promise) work.current = null;
      })
      .catch(() => {});
  }
  useEffect(() => {
    stopAction.current = () => launch(finish);
  });

  function press() {
    if (currentPhase.current === "recording") {
      launch(finish);
      return;
    }
    if (currentPhase.current !== "idle" || disabled) return;
    if (!agreed.current) {
      Alert.alert(
        "Transcribe with Whisper?",
        "Your recording goes through our API to a Whisper model running inside a secure enclave (TEE) on NEAR AI Cloud. Kuvos keeps no audio or separate transcript. Review the text before you send it.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Record",
            onPress: () => {
              if (focused.current && !unavailable.current) {
                agreed.current = true;
                launch(start);
              }
            },
          },
        ],
      );
      return;
    }
    launch(start);
  }
  return <DictationButton phase={phase} disabled={disabled} onPress={press} />;
}
