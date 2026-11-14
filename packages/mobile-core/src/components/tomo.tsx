import { useEffect } from 'react';
import { Image } from 'expo-image';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '../theme';

export type TomoMood = 'idle' | 'hello' | 'thinking' | 'happy';

const art = {
  idle: require('../../assets/images/tomo-orb-idle.png'),
  hello: require('../../assets/images/tomo-orb-hello.png'),
  thinking: require('../../assets/images/tomo-orb-thinking.png'),
  happy: require('../../assets/images/tomo-orb-happy.png'),
};

/** Tomo, the periwinkle guide. Decorative unless `label` is given. */
export function Tomo({
  size = 96,
  mood = 'idle',
  label,
  animate = true,
}: {
  size?: number;
  mood?: TomoMood;
  label?: string;
  animate?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const float = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || !animate) return;
    float.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(float);
  }, [animate, float, reduceMotion]);

  const body = useAnimatedStyle(() => ({
    transform: [{ translateY: animate && !reduceMotion ? (float.value - 0.5) * size * 0.06 : 0 }],
  }));

  return (
    <View
      accessible={!!label}
      accessibilityElementsHidden={!label}
      accessibilityLabel={label}
      accessibilityRole={label ? 'image' : undefined}
      importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
      style={{ width: size * 1.2, height: size * 1.2, alignItems: 'center' }}
    >
      <Animated.View style={body}>
        <Image
          source={art[mood]}
          contentFit="contain"
          accessible={false}
          style={{ width: size * 1.2, height: size * 1.2 }}
        />
      </Animated.View>
    </View>
  );
}

/** Three dots that pulse while Tomo is "typing". */
export function TomoTyping() {
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.value = withRepeat(withTiming(3, { duration: 900, easing: Easing.linear }), -1);
    return () => cancelAnimation(pulse);
  }, [pulse, reduceMotion]);

  return (
    <View
      accessibilityLabel="Tomo is typing"
      className="flex-row items-center gap-1.5 self-start rounded-3xl rounded-tl-lg bg-white px-4 py-4"
    >
      {[0, 1, 2].map((dot) => (
        <Dot key={dot} index={dot} pulse={pulse} />
      ))}
    </View>
  );
}

function Dot({ index, pulse }: { index: number; pulse: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const distance = Math.abs(((pulse.value - index + 3) % 3) - 0.5);
    const active = Math.max(0, 1 - distance);
    return { opacity: 0.3 + active * 0.7, transform: [{ translateY: -active * 3 }] };
  });
  return (
    <Animated.View
      style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.slate }, style]}
    />
  );
}
