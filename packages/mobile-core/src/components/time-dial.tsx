import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Text } from './text';

const STEP = 15;

export function shiftTime(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const total = (((hour * 60 + minute + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function timeParts(time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return {
    clock: `${hour % 12 || 12}:${String(minute).padStart(2, '0')}`,
    period: hour < 12 ? 'AM' : 'PM',
  };
}

export function formatTime(time: string) {
  const { clock, period } = timeParts(time);
  return `${clock} ${period}`;
}

function Nudge({ label, sign, onPress }: { label: string; sign: '−' | '+'; onPress: () => void }) {
  const repeat = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => () => clearInterval(repeat.current), []);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      className="h-14 w-14 items-center justify-center rounded-full bg-cloud"
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      onLongPress={() => {
        repeat.current = setInterval(onPress, 120);
      }}
      onPress={onPress}
      onPressOut={() => clearInterval(repeat.current)}
    >
      <Text className="text-3xl text-deep-blue">{sign}</Text>
    </Pressable>
  );
}

/** A large clock face with 15-minute nudges and quick picks; no wheel needed. */
export function TimeDial({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  presets: string[];
  onChange: (value: string) => void;
}) {
  const { clock, period } = timeParts(value);
  // Long-press repeats outlive a render, so nudges read the newest value from here.
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  const nudge = (minutes: number) => {
    void Haptics.selectionAsync().catch(() => undefined);
    latest.current = shiftTime(latest.current, minutes);
    onChange(latest.current);
  };

  return (
    <View className="gap-5">
      <View
        accessible
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: formatTime(value) }}
        className="flex-row items-center justify-between rounded-[32px] bg-white px-4 py-6"
        onAccessibilityAction={(event) => nudge(event.nativeEvent.actionName === 'increment' ? STEP : -STEP)}
      >
        <Nudge label={`${STEP} minutes earlier`} sign="−" onPress={() => nudge(-STEP)} />
        <Animated.View key={value} entering={FadeIn.duration(160)} className="flex-row items-baseline gap-1.5">
          <Text className="font-serif text-3xl text-deep-blue" style={{ fontVariant: ['tabular-nums'] }}>
            {clock}
          </Text>
          <Text className="text-base font-semibold text-slate">{period}</Text>
        </Animated.View>
        <Nudge label={`${STEP} minutes later`} sign="+" onPress={() => nudge(STEP)} />
      </View>
      <View className="flex-row flex-wrap justify-center gap-2">
        {presets.map((preset) => {
          const selected = preset === value;
          return (
            <Pressable
              key={preset}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`min-h-11 justify-center rounded-full border px-4 ${selected ? 'border-deep-blue bg-deep-blue' : 'border-line bg-white'}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => undefined);
                onChange(preset);
              }}
            >
              <Text className={`text-sm font-semibold ${selected ? 'text-white' : 'text-deep-blue'}`}>
                {formatTime(preset)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
