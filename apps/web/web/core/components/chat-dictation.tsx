import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { api } from '@kuvos/mobile-core/api';
import { appendTranscript, dictationConsentVersion } from '@kuvos/mobile-core/chat';
import { colors } from '@kuvos/mobile-core/theme';
import { Text } from '@kuvos/mobile-core/components/text';

type Props = {
  patientId: string;
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
  onActiveChange: (active: boolean) => void;
  disabled: boolean;
};
type Phase = 'idle' | 'starting' | 'recording' | 'transcribing';

// The API accepts M4A or WAV only. Browsers record WebM/Opus or MP4, so the web app captures
// raw PCM and encodes 16 kHz mono WAV: 60 s is about 1.9 MB, under the API's 2 MB limit.
// Audio stays in memory and is dropped after the request; nothing is written to storage.
const TARGET_RATE = 16_000;
const MAX_SECONDS = 60;

function encodeWav(chunks: Float32Array[], inputRate: number) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const ratio = inputRate / TARGET_RATE;
  const frames = Math.min(Math.floor(total / ratio), TARGET_RATE * MAX_SECONDS);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) {
    // Average the source samples that fall into this output frame (simple low-pass).
    const start = Math.floor(i * ratio);
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += merged[j] ?? 0;
    const sample = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

type Recording = {
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
};

function stopRecording(recording: Recording | null) {
  if (!recording) return;
  recording.processor.onaudioprocess = null;
  recording.processor.disconnect();
  recording.stream.getTracks().forEach((track) => track.stop());
  void recording.context.close().catch(() => undefined);
}

function DictationButton({ phase, disabled, onPress }: { phase: Phase; disabled: boolean; onPress: () => void }) {
  const waiting = phase !== 'idle' && phase !== 'recording';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        phase === 'recording' ? 'Stop recording and transcribe' : phase === 'transcribing' ? 'Transcribing recording' : 'Record a message'
      }
      accessibilityState={{ disabled: disabled || waiting, busy: waiting }}
      disabled={disabled || waiting}
      onPress={onPress}
      className={`min-h-12 min-w-12 items-center justify-center rounded-2xl ${phase === 'recording' ? 'bg-sun' : 'bg-cloud'}`}
    >
      {phase === 'recording' ? (
        <Text className="text-sm font-semibold text-deep-blue">Stop</Text>
      ) : waiting ? (
        <ActivityIndicator size="small" color={colors.deepBlue} />
      ) : (
        <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
          <Rect x={9} y={2} width={6} height={12} rx={3} stroke={colors.deepBlue} strokeWidth={1.8} fill="none" />
          <Path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" stroke={colors.deepBlue} strokeWidth={1.8} strokeLinecap="round" fill="none" />
        </Svg>
      )}
    </Pressable>
  );
}

export function ChatDictation({ patientId, value, onChange, onError, onActiveChange, disabled }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const current = useRef<Phase>('idle');
  const recording = useRef<Recording | null>(null);
  const upload = useRef<AbortController | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const agreed = useRef(false);
  const draft = useRef('');
  const unavailable = useRef(disabled);
  const finishRef = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    unavailable.current = disabled;
  }, [disabled]);

  const changePhase = useCallback(
    (next: Phase) => {
      current.current = next;
      setPhase(next);
      onActiveChange(next !== 'idle');
    },
    [onActiveChange],
  );

  const cancel = useCallback(() => {
    generation.current++;
    upload.current?.abort();
    if (limit.current) clearTimeout(limit.current);
    stopRecording(recording.current);
    recording.current = null;
    if (current.current !== 'idle') changePhase('idle');
  }, [changePhase]);

  useFocusEffect(useCallback(() => () => cancel(), [cancel]));
  // A recording must never carry over to another care subject.
  useEffect(() => cancel(), [patientId, cancel]);
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      cancel();
      onActiveChange(false);
    };
  }, [cancel, onActiveChange]);

  async function start() {
    const token = ++generation.current;
    changePhase('starting');
    onError('');
    draft.current = value;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This browser cannot record audio. You can still type.');
      }
      const stream = await navigator.mediaDevices
        .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
        .catch(() => {
          throw new Error('Microphone access is off. Allow it in your browser settings or type instead.');
        });
      if (token !== generation.current || unavailable.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor);
      processor.connect(context.destination);
      recording.current = { stream, context, processor, chunks };
      changePhase('recording');
      limit.current = setTimeout(() => {
        if (token === generation.current && current.current === 'recording') finishRef.current();
      }, MAX_SECONDS * 1000);
    } catch (error) {
      if (token === generation.current) {
        onError(error instanceof Error ? error.message : 'Recording could not start. You can still type.');
        changePhase('idle');
      }
    }
  }

  async function finish() {
    const token = generation.current;
    const active = recording.current;
    recording.current = null;
    if (limit.current) clearTimeout(limit.current);
    stopRecording(active);
    if (!active) return changePhase('idle');
    changePhase('transcribing');
    const controller = new AbortController();
    upload.current = controller;
    const timeout = setTimeout(() => controller.abort(), 55_000);
    try {
      const audio = encodeWav(active.chunks, active.context.sampleRate);
      active.chunks.length = 0;
      if (audio.size <= 44 + TARGET_RATE / 5) throw new Error('No audio was captured. Please record again.');
      const form = new FormData();
      form.append('audio', audio, 'dictation.wav');
      const result = await api<{ text: string }>(`/patients/${patientId}/chat/transcription`, {
        method: 'POST',
        headers: { 'X-Dictation-Consent': dictationConsentVersion },
        body: form,
        signal: controller.signal,
      });
      if (token === generation.current && !controller.signal.aborted) onChange(appendTranscript(draft.current, result.text));
    } catch (error) {
      if (token === generation.current && !controller.signal.aborted) {
        onError(error instanceof Error ? error.message : 'Transcription failed. You can still type.');
      }
    } finally {
      clearTimeout(timeout);
      upload.current = null;
      if (token === generation.current) changePhase('idle');
    }
  }
  useEffect(() => {
    finishRef.current = () => void finish();
  });

  function press() {
    if (current.current === 'recording') {
      void finish();
      return;
    }
    if (current.current !== 'idle' || disabled) return;
    if (!agreed.current) {
      Alert.alert(
        'Transcribe with Whisper?',
        'Your recording goes through our API to a Whisper model running inside a secure enclave (TEE) on NEAR AI Cloud. Kuvos keeps no audio or separate transcript. Review the text before you send it.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Record',
            onPress: () => {
              if (!unavailable.current) {
                agreed.current = true;
                void start();
              }
            },
          },
        ],
      );
      return;
    }
    void start();
  }

  return <DictationButton phase={phase} disabled={disabled} onPress={press} />;
}
