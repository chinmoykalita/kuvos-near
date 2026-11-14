import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { BrandLogo } from '@kuvos/mobile-core/components/brand-logo';
import { Text } from '@kuvos/mobile-core/components/text';
import { logoWordmark } from '@kuvos/mobile-core/config';
import { useWideLayout } from '../../layout';

// Phones keep the app's logo header. On wide screens the sidebar already carries the logo,
// so the page shows a heading with today's date instead.
export function SeekerHeader({ label = 'Today', onPress }: { label?: string; onPress?: () => void }) {
  const router = useRouter();
  const wide = useWideLayout();
  return (
    <View className="flex-row items-center justify-between gap-3 pb-2">
      {wide ? (
        <View>
          <Text accessibilityRole="header" className="font-serif text-3xl text-deep-blue">Today</Text>
          <Text className="text-sm text-slate">
            {new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}
          </Text>
        </View>
      ) : (
        <View className="flex-row items-center gap-2">
          <BrandLogo size={28} />
          <Text className="text-brand text-deep-blue">{logoWordmark}</Text>
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress ?? (() => router.push('/today'))}
        className="min-h-10 justify-center rounded-full bg-deep-blue px-[18px]"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Text className="text-sm font-bold text-white">{label}</Text>
      </Pressable>
    </View>
  );
}
