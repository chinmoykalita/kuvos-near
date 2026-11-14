import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Button } from '../components/button';
import { Glow } from '../components/glow';
import { Text } from '../components/text';
import { Tomo } from '../components/tomo';
import { colors } from '../theme';

const skills = [
  {
    label: 'Reads papers',
    icon: (
      <>
        <Rect x={6} y={3} width={12} height={18} rx={2} />
        <Path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
  },
  {
    label: 'Reminds',
    icon: (
      <>
        <Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" />
        <Path d="M10 20.5a2 2 0 0 0 4 0" />
      </>
    ),
  },
  {
    label: 'Keeps track',
    icon: (
      <>
        <Path d="M4 19h16" />
        <Path d="M7 15l3.5-4 3 2.5L18 8" />
      </>
    ),
  },
  {
    label: 'Your people',
    icon: (
      <>
        <Circle cx={9} cy={8} r={3} />
        <Path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
        <Circle cx={16.5} cy={9} r={2.4} />
        <Path d="M16 14.2c2.3.2 4 1.8 4.5 4.8" />
      </>
    ),
  },
];

export function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-1 bg-cloud px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <Glow height={620} />
      <View className="flex-1 items-center justify-center gap-6">
        <Animated.View entering={FadeInDown.duration(500)}>
          <Tomo size={150} mood="hello" label="Tomo winking hello" />
        </Animated.View>
        <Animated.View entering={FadeInUp.delay(150).duration(450)} className="items-center gap-3">
          <Text accessibilityRole="header" className="text-center font-serif text-3xl text-deep-blue">
            Hi, I’m <Text className="font-serif-italic text-cobalt">Tomo</Text>
          </Text>
          <Text className="max-w-[280px] text-center text-lg leading-6 text-slate">
            I’ll help you with your plan, every day.
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInUp.delay(300).duration(450)} className="w-full items-center gap-4 pt-2">
          <View className="w-full flex-row justify-between">
            {skills.map((skill) => (
              <View key={skill.label} className="flex-1 items-center gap-2">
                <View className="h-11 w-11 items-center justify-center rounded-full bg-white">
                  <Svg
                    width={20}
                    height={20}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={colors.deepBlue}
                    strokeWidth={1.7}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {skill.icon}
                  </Svg>
                </View>
                <Text className="text-center text-xs text-slate">{skill.label}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </View>

      <Animated.View entering={FadeInUp.delay(450).duration(450)} className="gap-2">
        <Button title="Get started" size="hero" onPress={() => router.push('/get-started')} />
        <Pressable
          accessibilityRole="button"
          className="min-h-12 items-center justify-center"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          onPress={() => router.push('/sign-in')}
        >
          <Text className="text-base font-semibold text-deep-blue">I already have an account</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
